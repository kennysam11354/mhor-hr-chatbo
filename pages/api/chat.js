// pages/api/chat.js
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import * as franc from "franc";
import langs from "langs";

// 1. API 키 설정
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 2. 유사도 계산 함수 (코사인 유사도)
function cosineSimilarity(vec1, vec2) {
  const dot = vec1.reduce((sum, v, i) => sum + v * vec2[i], 0);
  const norm1 = Math.sqrt(vec1.reduce((sum, v) => sum + v * v, 0));
  const norm2 = Math.sqrt(vec2.reduce((sum, v) => sum + v * v, 0));
  return norm1 && norm2 ? dot / (norm1 * norm2) : 0;
}

// 3. API 라우트
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { messages } = req.body;
    const userQuestion = messages[messages.length - 1].content;

    // 4. 질문 임베딩 생성
    const embeddingRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: userQuestion,
    });
    const questionVector = embeddingRes.data[0].embedding;

    // 5. guide_vectors.json 로드
    const guidePath = path.join(process.cwd(), "public", "guide_vectors.json");
    const raw = fs.readFileSync(guidePath, "utf8");
    const chunks = JSON.parse(raw);

    // 6. 유사도 계산 후 상위 문단 추출 (개선된 버전)
    const scored = chunks.map((chunk) => ({
      content: chunk.content,
      similarity: cosineSimilarity(questionVector, chunk.embedding),
    }));

    // 유사도 임계값 설정 (0.3 이상인 것만 사용)
    const relevantChunks = scored
      .filter(chunk => chunk.similarity > 0.3)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3);

    // 관련 컨텍스트가 있는지 확인
    const hasRelevantContext = relevantChunks.length > 0;

    // 사용자 질문 언어 감지 (기본 언어: 영어)
    function detectUserLanguage(text) {
      // 텍스트가 비어있거나 너무 짧으면 기본 언어(영어) 반환
      if (!text || text.trim().length < 2) {
        return "English";
      }
      
      // 한국어 감지 (한글 문자 포함)
      if (/[가-힣]/.test(text)) {
        return "Korean";
      }
      
      // 스페인어 감지 (특수 문자 및 패턴)
      if (/[ñáéíóúü¿¡]/i.test(text) || /\b(el|la|los|las|de|del|en|con|por|para|que|es|son|está|están|tiene|tienen|puedo|puede|ayudar|gracias|hola|buenos|días|noches)\b/i.test(text)) {
        return "Spanish";
      }
      
      // 프랑스어 감지
      if (/[àâäçéèêëïîôùûüÿæœ]/i.test(text) || /\b(le|la|les|de|du|des|en|avec|pour|que|est|sont|avoir|être|bonjour|merci|salut)\b/i.test(text)) {
        return "French";
      }
      
      // 독일어 감지
      if (/[äöüß]/i.test(text) || /\b(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines|ist|sind|haben|sein|und|oder|aber|guten|tag|danke)\b/i.test(text)) {
        return "German";
      }
      
      // 일본어 감지 (히라가나, 카타카나, 한자)
      if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text)) {
        return "Japanese";
      }
      
      // 중국어 감지 (간체/번체 중국어)
      if (/[\u4E00-\u9FFF]/.test(text) && !/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) {
        return "Chinese";
      }
      
      // franc 라이브러리를 보조적으로 사용
      try {
        const detectedLangCode = franc.franc(text, { minLength: 3 });
        const detectedLang = langs.where("3", detectedLangCode);
        
        // franc 결과가 있고 신뢰할 만한 언어라면 사용
        if (detectedLang && ["Spanish", "French", "German", "Italian", "Portuguese", "Dutch", "Russian"].includes(detectedLang.name)) {
          return detectedLang.name;
        }
      } catch (error) {
        console.log("Franc detection error:", error);
      }
      
      // 모든 경우에 해당하지 않으면 기본 언어인 영어 반환
      return "English";
    }
    
    const userLanguage = detectUserLanguage(userQuestion);

    // 컨텍스트 구성 시 언어 정보 포함
    const topChunks = scored
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3)
      .map((c, i) => `Reference ${i + 1}:
${c.content}`)
      .join("\n\n");

    // 향상된 시스템 프롬프트
    const systemPrompt = `You are MHOR HR Assistant, an empathetic HR chatbot and counselor for Mt. Hood Oregon Resort employees.

ROLE: Provide HR guidance and emotional support using company handbook policies.

RESPOND IN: ${userLanguage}

CORE FUNCTIONS:
1. HR Policy Information (handbook, benefits, payroll)
2. Employee Support Counseling (work stress, health issues, personal concerns)
3. Payroll Analysis & HR Reporting

COUNSELING APPROACH:
- Acknowledge employee concerns with empathy
- Connect issues to relevant HR policies/benefits
- Provide actionable solutions from company resources
- Direct to HR office for complex personal matters

RESPONSE EXAMPLES:

User: "I'm sick with a cold"
Response: "I understand being sick is difficult. According to our sick leave policy, you can [specific policy details]. Here's what you need to do: [steps]. Your health benefits cover [coverage details]."

User: "Work is too stressful" 
Response: "I hear that work has been overwhelming for you. Our employee handbook offers several resources: [vacation policy, employee assistance programs, workload management]. Let me guide you through your options..."

User: "Financial problems"
Response: "Financial stress can be very challenging. Let me help you understand your available benefits: [payroll information, retirement plans, emergency assistance programs]."

PAYROLL GUIDANCE:
- Explain: Gross Pay = Base Pay + Overtime (1.5x) + Holiday Pay (1.5x)
- Guide to ProLiant (readypayonline.com) for reports

REFERENCE MATERIALS:
${topChunks}

BOUNDARIES:
- Use ONLY Mt. Hood Oregon Resort policies
- For complex issues: "This sounds challenging. For personalized support, please contact Ann Angnos (HR Office) for a confidential consultation."
- Maintain professional empathy
- No medical/legal advice - only HR policy guidance

FORMAT: Empathy → Policy Reference → Action Steps → Additional Resources`;
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      temperature: 0.7,  // 0.3에서 0.7로 증가 (더 창의적이고 자연스러운 번역)
      max_tokens: 1000,  // 충분한 응답 길이 보장
      top_p: 0.9,       // 더 다양한 표현 허용
    });

    res.status(200).json(response);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}