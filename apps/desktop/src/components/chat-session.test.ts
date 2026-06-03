import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseCharacterCard, type CharacterCard } from "./character-cards.ts";
import { composeCharacterSessionPrompt, parseCharacterReply } from "./chat-session.ts";
import type { ChatMessage } from "./chat-model.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadFixtureCard(characterId: string): Promise<CharacterCard> {
  const path = resolve(
    __dirname,
    `../../public/characters/${characterId}.card/card.json`
  );
  const raw = JSON.parse(await readFile(path, "utf8"));
  return parseCharacterCard(characterId, raw);
}

const card = await loadFixtureCard("shili");

test("composeCharacterSessionPrompt includes character persona, context, and sticker protocol without input modes", () => {
  const history: ChatMessage[] = [
    {
      id: "u1",
      speaker: "user",
      author: "你",
      text: "我有点卡住，但还想把设置页做完。",
      time: "10:10"
    },
    {
      id: "a1",
      speaker: "character",
      author: "示璃",
      text: "先稳住，我们只处理模型供应商这一块。",
      time: "10:11"
    }
  ];

  const prompt = composeCharacterSessionPrompt({
    card,
    history,
    userPrompt: "帮我把下一步拆出来"
  });

  assert.match(prompt, /名字：示璃/);
  assert.match(prompt, /背景：示璃出身于家境良好的书香家庭/);
  assert.match(prompt, /父母都是大学教授/);
  assert.match(prompt, /清华大学/);
  assert.doesNotMatch(prompt, /背景：示璃诞生在 Cockapoo Pi Companion/);
  assert.doesNotMatch(prompt, /当前模式/);
  assert.match(prompt, /可以帮助用户推进代码、设计、排查和文档工作/);
  assert.match(prompt, /只在情绪节点偶尔输出一个表情标记/);
  assert.match(prompt, /\[sticker:happy\]/);
  assert.match(prompt, /## 对话示例/);
  assert.match(prompt, /用户：我感觉今天什么都没做完/);
  assert.match(prompt, /示璃：先停一下/);
  assert.match(prompt, /用户：我有点卡住/);
  assert.match(prompt, /示璃：先稳住/);
  assert.match(prompt, /用户：帮我把下一步拆出来/);
});

test("composeCharacterSessionPrompt uses the selected character card", async () => {
  const lulinCard = await loadFixtureCard("lulin");
  const prompt = composeCharacterSessionPrompt({
    card: lulinCard,
    history: [],
    userPrompt: "今晚状态有点散"
  });

  assert.match(prompt, /名字：陆临/);
  assert.match(prompt, /背景：陆临像一个总在凌晨还开着灯的协作者/);
  assert.doesNotMatch(prompt, /名字：示璃/);
});

test("composeCharacterSessionPrompt can include current time perception", () => {
  const prompt = composeCharacterSessionPrompt({
    card,
    history: [],
    userPrompt: "我还在改东西",
    timeContext: [
      "系统记录的本地时间：2026年6月3日 星期三 02:48",
      "时区：Asia/Shanghai",
      "时间氛围：都快凌晨三点了。"
    ].join("\n")
  });

  assert.match(prompt, /## 当前真实时间/);
  assert.match(prompt, /系统记录的本地时间：2026年6月3日 星期三 02:48/);
  assert.match(prompt, /时区：Asia\/Shanghai/);
  assert.match(prompt, /时间氛围：都快凌晨三点了。/);
});

test("parseCharacterReply extracts one allowed sticker marker and removes it from text", () => {
  const reply = parseCharacterReply("先把范围缩小到输入框和保存按钮。\n[sticker:focused]", card.stickers);

  assert.equal(reply.text, "先把范围缩小到输入框和保存按钮。");
  assert.equal(reply.sticker?.id, "focused");
});

test("parseCharacterReply ignores unsupported sticker markers", () => {
  const reply = parseCharacterReply("这个先不急。\n[sticker:laser]", card.stickers);

  assert.equal(reply.text, "这个先不急。");
  assert.equal(reply.sticker, undefined);
  assert.deepEqual(reply.impressions, []);
});

test("parseCharacterReply extracts memory markers and removes them from text", () => {
  const reply = parseCharacterReply(
    "记住啦，我们慢慢来。\n[memory:like] 用户喜欢深夜写代码\n[sticker:happy]",
    card.stickers
  );

  assert.equal(reply.text, "记住啦，我们慢慢来。");
  assert.equal(reply.sticker?.id, "happy");
  assert.deepEqual(reply.impressions, [{ kind: "like", text: "用户喜欢深夜写代码" }]);
});
