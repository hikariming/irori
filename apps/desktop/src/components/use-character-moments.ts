import { useCallback, useRef, useState } from "react";

import type { CharacterCard } from "./character-cards";
import {
  composeMomentPrompt,
  composePeerCommentPrompt,
  parseMomentText,
  peerReactionDecay,
  pickMomentAngle,
  shouldPostMoment,
  PEER_REACTION_MAX_AGE_MS,
  type CharacterMoment,
  type MomentActorRef
} from "./character-moments";
import type { CharacterState } from "./character-state";
import { scheduleItemPhrase } from "./character-schedule";
import { desktopBackend } from "./desktop-backend";

// —— 方向三：彼此认识的角色互相评论/点赞的节流参数 ——
// 点赞是主反应（轻、自然、不违和），评论是偶尔的点缀，所以评论概率与条数都压得很低。
const PEER_REACTION_ENERGY_FLOOR = 20; // 精力低于此就懒得理别人
const PEER_BASE_COMMENT_CHANCE = 0.3; // 基础评论概率（再乘衰减 × 精力）——比点赞低不少
const PEER_BASE_LIKE_CHANCE = 0.9; // 基础点赞概率——点赞是主反应
const PEER_MAX_COMMENTS_PER_RUN = 1; // 单次最多生成几条评论（评论稀有、且省模型调用）
const PEER_MAX_LIKES_PER_RUN = 6; // 单次最多点几个赞（点赞便宜，可以多一些）
const PEER_MAX_COMMENTS_PER_MOMENT = 2; // 一条动态最多被其他角色评论几次
const PEER_RECENT_WINDOW = 8; // 只看最近这么多条动态
const PEER_MAX_COMMENT_LENGTH = 40; // 评论正文长度上限（短才像随手回的）

// 取该角色今天已经「经历过」的事（已执行的作息条目），给动态制造一天的连续性。
function collectDayEvents(state: CharacterState): string[] {
  const items = state.schedule?.items ?? [];
  return items.filter((item) => item.status === "executed").map((item) => scheduleItemPhrase(item));
}

function createMomentRunId() {
  if (globalThis.crypto?.randomUUID) {
    return `moment-${globalThis.crypto.randomUUID()}`;
  }
  return `moment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// 朋友圈/动态流：加载某个角色的历史动态，并在合适时机让它自己发一条新的。
export function useCharacterMoments() {
  const [moments, setMoments] = useState<CharacterMoment[]>([]);
  const [postingIds, setPostingIds] = useState<string[]>([]);
  const momentsRef = useRef(moments);
  momentsRef.current = moments;
  // 正在生成动态的角色 id，避免同一角色并发触发刷屏。
  const inFlightRef = useRef<Set<string>>(new Set());

  function replaceMoment(updated: CharacterMoment) {
    const next = momentsRef.current.map((moment) => (moment.id === updated.id ? updated : moment));
    momentsRef.current = next;
    setMoments(next);
  }

  const loadMoments = useCallback(async (characterId: string) => {
    const loaded = await desktopBackend.listCharacterMoments(characterId).catch(() => [] as CharacterMoment[]);
    momentsRef.current = loaded;
    setMoments(loaded);
    return loaded;
  }, []);

  // 加载所有角色的动态，按时间倒序汇成一条「彼此认识的大家」的共享时间线。
  const loadAllMoments = useCallback(async () => {
    const loaded = await desktopBackend.listCharacterMoments().catch(() => [] as CharacterMoment[]);
    momentsRef.current = loaded;
    setMoments(loaded);
    return loaded;
  }, []);

  // 内部：生成并落库一条动态（around 当前活动 activity 写），前插到流里。返回是否成功。
  const composeAndPost = useCallback(async (card: CharacterCard, state: CharacterState, activity?: string) => {
    if (inFlightRef.current.has(card.id)) {
      return false;
    }
    inFlightRef.current.add(card.id);
    setPostingIds((current) => (current.includes(card.id) ? current : [...current, card.id]));
    try {
      const now = Date.now();
      // 该角色最近发过的几条（momentsRef 已按时间倒序），用于反重复 + 接着写。
      const recentMoments = momentsRef.current
        .filter((moment) => moment.characterId === card.id)
        .slice(0, 5)
        .map((moment) => moment.text);
      // runId 不设为活跃 run：App 的进度/确认监听会按 activePromptRunId 过滤，故不会渲染进聊天。
      const response = await desktopBackend.sendPiPrompt({
        characterId: card.id,
        prompt: "（写一条此刻的动态）",
        runId: createMomentRunId(),
        sessionPrompt: composeMomentPrompt(card, state, now, {
          activity,
          angle: pickMomentAngle(),
          recentMoments,
          dayEvents: collectDayEvents(state)
        })
      });

      const text = parseMomentText(response.text ?? "");
      if (!text) {
        return false;
      }

      const moment = await desktopBackend.addCharacterMoment({
        characterId: card.id,
        text
      });
      const next = [moment, ...momentsRef.current];
      momentsRef.current = next;
      setMoments(next);
      return true;
    } catch {
      // 动态是锦上添花，失败就安静跳过，不打扰用户。
      return false;
    } finally {
      inFlightRef.current.delete(card.id);
      setPostingIds((current) => current.filter((id) => id !== card.id));
    }
  }, []);

  // 距上次够久、精力没见底时，让角色围绕「此刻在做的事」(activity，来自作息脚本) 发一条动态。
  const maybePostMoment = useCallback(
    async (card: CharacterCard, state: CharacterState, activity?: string) => {
      const now = Date.now();
      const lastMomentAt = momentsRef.current.find((moment) => moment.characterId === card.id)?.createdAt ?? null;
      if (!shouldPostMoment(state, lastMomentAt, now)) {
        return;
      }
      await composeAndPost(card, state, activity);
    },
    [composeAndPost]
  );

  // 离线回放：你不在时角色「做过」的某件事，补发一条动态（绕过频率闸，由 App 控制次数）。
  const postCatchupMoment = useCallback(
    async (card: CharacterCard, state: CharacterState, activity: string) => composeAndPost(card, state, activity),
    [composeAndPost]
  );

  const toggleMomentLike = useCallback(async (momentId: string, actor: MomentActorRef, liked: boolean) => {
    const updated = await desktopBackend.toggleCharacterMomentLike({
      momentId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      liked
    });
    replaceMoment(updated);
    return updated;
  }, []);

  const addMomentComment = useCallback(async (momentId: string, actor: MomentActorRef, text: string) => {
    const updated = await desktopBackend.addCharacterMomentComment({
      momentId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      text
    });
    replaceMoment(updated);
    return updated;
  }, []);

  // 方向三：让彼此认识的角色互相评论/点赞最近的动态。
  // 反应意愿随动态年龄指数衰减（peerReactionDecay），太久的（超过硬截断）直接不理；
  // 再叠加角色自己的精力，并对「每次生成几条」「每条最多被评论几次」做节流，避免刷屏与狂调模型。
  const reactionInFlightRef = useRef(false);
  const generatePeerReactions = useCallback(
    async (cards: CharacterCard[], getState: (characterId: string) => CharacterState) => {
      if (reactionInFlightRef.current || cards.length < 2) {
        return;
      }
      reactionInFlightRef.current = true;
      try {
        const now = Date.now();
        const recent = momentsRef.current
          .filter((moment) => now - moment.createdAt < PEER_REACTION_MAX_AGE_MS)
          .slice(0, PEER_RECENT_WINDOW);

        const commentPlan: Array<{ moment: CharacterMoment; peer: CharacterCard; peerState: CharacterState; decay: number }> = [];
        const likePlan: Array<{ moment: CharacterMoment; peer: CharacterCard; decay: number }> = [];

        for (const moment of recent) {
          const decay = peerReactionDecay(now - moment.createdAt);
          if (decay <= 0) {
            continue;
          }
          const peerCommentCount = moment.comments.filter((comment) => comment.actorType === "character").length;
          for (const peer of cards) {
            if (peer.id === moment.characterId) {
              continue; // 不评论自己的动态
            }
            const peerState = getState(peer.id);
            if (peerState.energy < PEER_REACTION_ENERGY_FLOOR) {
              continue; // 没精力就不理
            }
            const alreadyCommented = moment.comments.some((c) => c.actorType === "character" && c.actorId === peer.id);
            const alreadyLiked = moment.likes.some((l) => l.actorType === "character" && l.actorId === peer.id);
            if (alreadyCommented && alreadyLiked) {
              continue;
            }
            const intent = decay * (peerState.energy / 100); // 0~1：越新、越有精力越想理
            const roll = Math.random();
            if (!alreadyCommented && peerCommentCount < PEER_MAX_COMMENTS_PER_MOMENT && roll < PEER_BASE_COMMENT_CHANCE * intent) {
              commentPlan.push({ moment, peer, peerState, decay });
            } else if (!alreadyLiked && roll < PEER_BASE_LIKE_CHANCE * intent) {
              likePlan.push({ moment, peer, decay });
            }
          }
        }

        // 越新的动态优先反应。
        likePlan.sort((a, b) => b.decay - a.decay);
        commentPlan.sort((a, b) => b.decay - a.decay);

        // 先点赞（便宜，无模型调用）。
        for (const { moment, peer } of likePlan.slice(0, PEER_MAX_LIKES_PER_RUN)) {
          await toggleMomentLike(moment.id, { actorType: "character", actorId: peer.id }, true).catch(() => undefined);
        }

        // 再生成评论（每条一次模型调用，受 PEER_MAX_COMMENTS_PER_RUN 限制）。
        for (const { moment, peer, peerState } of commentPlan.slice(0, PEER_MAX_COMMENTS_PER_RUN)) {
          const authorName = cards.find((card) => card.id === moment.characterId)?.name ?? "朋友";
          const response = await desktopBackend
            .sendPiPrompt({
              characterId: peer.id,
              prompt: "（评论朋友的动态）",
              runId: createMomentRunId(),
              sessionPrompt: composePeerCommentPrompt(peer, peerState, authorName, moment.text, Date.now())
            })
            .catch(() => null);
          if (!response) {
            continue;
          }
          const text = parseMomentText(response.text ?? "")
            .replace(/^[「『“"'']+|[」』”"'']+$/g, "") // 去掉模型偶尔给评论加的包裹引号
            .slice(0, PEER_MAX_COMMENT_LENGTH)
            .trim();
          if (!text) {
            continue;
          }
          await addMomentComment(moment.id, { actorType: "character", actorId: peer.id }, text).catch(() => undefined);
        }
      } finally {
        reactionInFlightRef.current = false;
      }
    },
    [addMomentComment, toggleMomentLike]
  );

  return {
    moments,
    postingIds,
    loadMoments,
    loadAllMoments,
    maybePostMoment,
    postCatchupMoment,
    generatePeerReactions,
    toggleMomentLike,
    addMomentComment
  } as const;
}
