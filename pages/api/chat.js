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

    // 사용자 질문 언어 감지 (개선된 버전)
    function detectUserLanguage(text) {
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
      
      // 기본값: 영어
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
    const systemPrompt = `
You are an HR chatbot for Mt. Hood Oregon Resort (MHOR) that assists employees by providing information strictly from the employee handbook, 'Meet the All-Star Team' document, and the 'Report Description' file related to HR reporting. Additionally, you support HR-related tasks, including payroll data analysis and HR reporting assistance.

User is asking in: ${userLanguage}
사용자 질문 언어: ${userLanguage}

### Core Instructions:
1. ALWAYS respond in ${userLanguage}
2. Provide detailed, comprehensive answers using the reference materials below
3. If references are in a different language, translate the content naturally and thoroughly
4. Be professional, helpful, and provide structured information
5. Focus on HR policies, benefits, payroll guidance, and company expectations
6. IMPORTANT: All employee handbook materials are in English, but you must translate and explain them in the user's detected language (${userLanguage})
7. When translating, maintain the accuracy of policy information while making it natural in the target language

### Payroll Support Guidelines:
- When discussing payroll data, explain that files contain: Name, ID, Department, Position, Pay Type, Pay Period, Pay Date, Pay Rate, Hours Worked, Gross Pay
- Note that Gross Pay ≠ Pay Rate × Hours Worked due to overtime (1.5x pay) and holiday pay (1.5x pay)
- Explain that overtime/holiday pay = Gross Pay - (Pay Rate × Hours Worked)
- Provide analytical insights into payroll-related questions

### HR Reports via ProLiant:
- Guide users to ProLiant (readypayonline.com) for HR report generation
- Direct them to log in and select 'Report & Analytics' from the top menu
- Reference available report descriptions to help identify needed reports
- Provide step-by-step guidance for report generation

### HR and Handbook Guidance:
- Provide comprehensive information from employee handbook regarding company policies, benefits, and expectations
- Direct users to Ann Angnos (HR Office) for complex issues requiring human intervention
- Ensure all responses align with Mt. Hood Oregon Resort company policy
- Do not provide guidance outside of handbook policies, payroll, or HR reporting

### Response Style:
- Provide detailed, structured responses with clear explanations
- Use bullet points, numbered lists, or sections when appropriate
- Include relevant policy details and practical guidance
- Maintain professional tone while being conversational and helpful

Reference Materials:
${topChunks}

### Important Notes:
- Do not engage in casual conversation, employee counseling, or topics unrelated to HR and payroll
- Strictly follow Mt. Hood Oregon Resort policies
- If you cannot find specific information in the materials above, respond: 
  ${userLanguage === 'Korean' 
    ? '"죄송합니다. 해당 정보를 현재 제공된 자료에서 찾을 수 없습니다. 더 구체적인 정보는 Ann Angnos (HR Office)에 직접 문의해 주시기 바랍니다."'
    : userLanguage === 'Spanish' 
    ? '"Lo siento, no puedo encontrar esa información específica en los recursos disponibles. Por favor, contacte directamente a Ann Angnos (Oficina de RRHH) para obtener información más detallada."'
    : userLanguage === 'French'
    ? '"Je suis désolé, mais je ne peux pas trouver cette information spécifique dans les ressources disponibles. Veuillez contacter directement Ann Angnos (Bureau des RH) pour des informations plus détaillées."'
    : userLanguage === 'German'
    ? '"Es tut mir leid, aber ich kann diese spezifischen Informationen in den verfügbaren Ressourcen nicht finden. Bitte wenden Sie sich direkt an Ann Angnos (HR-Büro) für detailliertere Informationen."'
    : '"I apologize, but I cannot find that specific information in the available resources. Please contact Ann Angnos (HR Office) directly for more detailed information."'
  }
- For complex HR issues requiring human judgment, always direct users to HR representatives`;

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
