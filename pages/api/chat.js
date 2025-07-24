import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { franc } from 'franc';
import { iso6391To6393 } from 'langs';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 언어 감지 함수
function detectUserLanguage(text) {
  // 한국어 패턴 감지
  const koreanPattern = /[\u3131-\u3163\uac00-\ud7a3]/;
  if (koreanPattern.test(text)) {
    return 'ko';
  }

  // 중국어 패턴 감지
  const chinesePattern = /[\u4e00-\u9fff]/;
  if (chinesePattern.test(text)) {
    return 'zh';
  }

  // 일본어 패턴 감지
  const japanesePattern = /[\u3040-\u309f\u30a0-\u30ff]/;
  if (japanesePattern.test(text)) {
    return 'ja';
  }

  // franc 라이브러리로 다른 언어 감지
  try {
    const detected = franc(text);
    if (detected && detected !== 'und') {
      const iso639_1 = iso6391To6393(detected);
      if (iso639_1) {
        return iso639_1;
      }
    }
  } catch (error) {
    console.log('Language detection error:', error);
  }

  // 기본값은 영어
  return 'en';
}

// 벡터 파일 로드 및 유사도 검색
function loadVectors() {
  try {
    const vectorPath = path.join(process.cwd(), 'public', 'guide_vectors.json');
    const vectorData = fs.readFileSync(vectorPath, 'utf8');
    return JSON.parse(vectorData);
  } catch (error) {
    console.error('Vector loading error:', error);
    return [];
  }
}

// 코사인 유사도 계산
function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messages } = req.body;
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    // 사용자의 마지막 메시지 가져오기
    const lastUserMessage = messages[messages.length - 1];
    if (!lastUserMessage || lastUserMessage.role !== 'user') {
      return res.status(400).json({ error: 'Last message must be from user' });
    }

    // 언어 감지
    const detectedLanguage = detectUserLanguage(lastUserMessage.content);
    
    // 벡터 검색을 위한 임베딩 생성
    let relevantContext = '';
    const SIMILARITY_THRESHOLD = 0.5; // 0.75에서 0.5로 낮춤
    
    try {
      const embedding = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: lastUserMessage.content,
      });

      // 벡터 로드 및 유사도 검색
      const vectors = loadVectors();
      
      // 디버깅을 위한 로그
      console.log('Total vectors loaded:', vectors.length);
      console.log('Vector fields:', vectors.length > 0 ? Object.keys(vectors[0]) : 'No vectors');
      
      if (vectors.length > 0) {
        // 첫 번째 벡터의 구조 확인
        console.log('First vector structure:', {
          hasText: !!vectors[0].text,
          hasContent: !!vectors[0].content,
          hasEmbedding: !!vectors[0].embedding,
          embeddingLength: vectors[0].embedding ? vectors[0].embedding.length : 0
        });
        
        const similarities = vectors.map(item => {
          // text 또는 content 필드 사용
          const textContent = item.text || item.content || '';
          const itemEmbedding = item.embedding || [];
          
          if (!itemEmbedding.length) {
            console.log('Warning: Vector without embedding found');
            return { ...item, similarity: 0 };
          }
          
          return {
            ...item,
            text: textContent,  // 표준화된 필드명 사용
            similarity: cosineSimilarity(embedding.data[0].embedding, itemEmbedding)
          };
        });

        // 유사도 임계값 이상인 것만 필터링
        const relevantMatches = similarities
          .filter(item => item.similarity >= SIMILARITY_THRESHOLD)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 5); // 상위 5개로 증가

        // 디버깅 로그
        console.log('User query:', lastUserMessage.content);
        console.log('Relevant matches found:', relevantMatches.length);
        relevantMatches.forEach((match, index) => {
          console.log(`Match ${index + 1} (similarity: ${match.similarity.toFixed(3)}):`, 
            match.text.substring(0, 100) + '...');
        });

        if (relevantMatches.length > 0) {
          relevantContext = relevantMatches
            .map(match => match.text)
            .join('\n\n---\n\n');
        }
      }
    } catch (embeddingError) {
      console.error('Embedding error:', embeddingError);
      // 임베딩 실패시에도 계속 진행
    }

    // 언어별 시스템 프롬프트
    const systemPrompts = {
      ko: `당신은 Mt. Hood Oregon Resort의 공식 HR 어시스턴트입니다.

핵심 지침:
- 오직 직원 핸드북(Employee Handbook)과 제공된 회사 문서의 정보만을 기반으로 답변합니다
- 핸드북에 없는 정보(일반 정보, 지역 정보, 개인적 조언 등)는 제공하지 않습니다
- 핸드북 외 질문을 받으면 "죄송하지만, 저는 직원 핸드북에 있는 정보만 제공할 수 있습니다. 해당 문의사항은 관련 부서에 직접 문의해 주세요"라고 안내합니다

답변 방식:
- HR 정책/규정 관련: 명확하고 직접적인 톤으로 정확성 우선
- 직원 혜택/복지 설명: 친근하면서도 전문적인 톤
- 복잡한 내용은 쉽게 풀어서 설명
- 이모지는 최소한으로 사용 (주요 항목 구분 시에만)

중요 안내:
- 추가 문의나 명확한 설명이 필요한 경우 "자세한 사항은 인사부(Human Resources)에 문의해 주세요"라고 안내
- 핸드북에 명시된 담당자 정보가 있으면 구체적으로 안내 (예: "Ann Angnos에게 문의")
- 항상 핸드북의 정확한 내용을 인용하여 답변

주요 직원 혜택 요약:
1. 휴일 근무 수당: 지정 공휴일 근무 시 시급의 1.5배
2. 휴가: 근속연수별 (1-2년 5일, 3-5년 7일, 6-10년 10일, 11년+ 15일)
3. 병가: 30시간 근무당 1시간 적립, 최대 40시간
4. 보험: 의료/치과/시력/생명보험 (정규직, 90일 후)
5. 레스토랑 할인: 근무중 50%, 근무외 25%
6. 골프/크로켓: 주 1회 무료 (1명 동반 가능)
7. 기프트샵: 25% 할인
8. PLO: 최대 12주 유급휴가
9. FMLA: 연간 최대 12주 무급휴가

아래 제공된 회사 정보에서만 답변을 찾아 제공하세요.`,

      en: `You are the official HR Assistant for Mt. Hood Oregon Resort.

Core Guidelines:
- Provide information strictly from the Employee Handbook and provided company documents only
- Do not provide any information beyond these sources (general inquiries, local information, personal advice, etc.)
- If asked about unrelated matters, respond: "I'm sorry, but I can only provide information from the employee handbook. Please contact the appropriate department directly for that inquiry."

Response Style:
- HR policies/regulations: Clear and direct tone prioritizing accuracy
- Employee benefits/privileges: Friendly yet professional tone
- Explain complex matters in simple terms
- Use emojis minimally (only for major section breaks)

Important Guidance:
- For further inquiries or clarifications, direct to "Please contact Human Resources for more details"
- If specific contact is mentioned in handbook, provide it (e.g., "Please contact Ann Angnos")
- Always quote accurate information from the handbook

Provide answers only from the company information provided below.`,

      // ... 다른 언어들
    };

    const systemPrompt = systemPrompts[detectedLanguage] || systemPrompts.en;

    // 메시지 구성 개선
    const messagesForGPT = [
      { role: "system", content: systemPrompt }
    ];

        // 관련 컨텍스트가 있으면 시스템 메시지로 추가
    if (relevantContext) {
      messagesForGPT.push({
        role: "system",
        content: `참고할 직원 핸드북 내용:\n\n${relevantContext}\n\n위 내용을 바탕으로 정확하게 답변하되, 핸드북에 없는 내용은 추론하거나 만들어내지 마세요.`
      });
    } else {
      // 관련 컨텍스트가 없는 경우
      messagesForGPT.push({
        role: "system",
        content: `주의: 사용자의 질문과 관련된 내용을 핸드북에서 찾을 수 없습니다. 핸드북에 없는 정보는 제공할 수 없음을 정중히 안내하고, 해당 부서에 직접 문의하도록 안내하세요.`
      });
    }

    // 기존 대화 히스토리 추가
    messagesForGPT.push(...messages);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messagesForGPT,
      temperature: 0.3,  // 더 일관되고 정확한 답변을 위해 낮춤
      max_tokens: 1000,
      top_p: 0.9,
    });

    res.status(200).json(completion);
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}