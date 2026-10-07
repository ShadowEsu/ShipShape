import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.EXPO_PUBLIC_OPENAI_KEY });

export async function askTutor(question: string) {
  const reply = await client.chat.completions.create({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: question }],
  });
  return reply.choices[0].message.content;
}
