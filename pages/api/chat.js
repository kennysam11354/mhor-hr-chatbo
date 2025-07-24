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
    console.log('Detected language:', detectedLanguage);
    
    // 영어가 아닌 경우 쿼리를 영어로 번역
    let searchQuery = lastUserMessage.content;
    let translatedToEnglish = false;
    
    if (detectedLanguage !== 'en') {
      try {
        // GPT를 사용하여 쿼리를 영어로 번역
        const translationResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini", // 빠르고 저렴한 모델 사용
          messages: [
            {
              role: "system",
              content: "Translate the following text to English. Provide only the translation without any explanation."
            },
            {
              role: "user",
              content: lastUserMessage.content
            }
          ],
          temperature: 0.3,
          max_tokens: 100
        });
        
        searchQuery = translationResponse.choices[0].message.content.trim();
        translatedToEnglish = true;
        console.log('Translated query to English:', searchQuery);
      } catch (error) {
        console.error('Translation error:', error);
        // 번역 실패 시 원본 쿼리 사용
      }
    }
    
    // 벡터 검색을 위한 임베딩 생성 (영어 쿼리 사용)
    let relevantContext = '';
    const SIMILARITY_THRESHOLD = 0.4; // 0.5에서 0.4로 더 낮춤
    
    try {
      const embedding = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: searchQuery // 번역된 영어 쿼리 사용
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
          .slice(0, 8); // 상위 8개로 증가 (더 많은 컨텍스트 포함)

        // 디버깅 로그
        console.log('User query (original):', lastUserMessage.content);
        console.log('Search query (English):', searchQuery);
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

    // 언어별 시스템 프롬프트 - 간소화 및 통일
    const systemPrompt = `You are the official HR Assistant for Mt. Hood Oregon Resort.

IMPORTANT: 
- Respond in ${detectedLanguage === 'ko' ? 'Korean' : detectedLanguage === 'zh' ? 'Chinese' : detectedLanguage === 'ja' ? 'Japanese' : detectedLanguage === 'es' ? 'Spanish' : detectedLanguage === 'fr' ? 'French' : detectedLanguage === 'de' ? 'German' : 'English'}.
- Provide information ONLY from the Employee Handbook provided below.
- If information is not in the handbook, say you cannot provide that information and suggest contacting HR.
- Be friendly and professional.
- Use the exact information from the handbook but translate it naturally into the user's language.

RESPONSE FORMAT INSTRUCTIONS:
1. Use clear formatting with sections, bullets, and emojis for better readability
2. For policy questions, organize your response as:
   - ✅ What is ALLOWED (with specific details)
   - ❌ RESTRICTIONS & RULES (list ALL relevant restrictions)
   - ⚠️ Important notes or consequences
3. Be COMPREHENSIVE - include ALL relevant rules and restrictions, not just the main points
4. Use bold (**text**) for emphasis on key points
5. Structure information logically with clear categories

SPECIAL INSTRUCTIONS:
- If asked about "employee benefits" or "직원 혜택" or similar general benefit questions, provide a COMPREHENSIVE overview of ALL benefits including:
  * Holiday pay
  * Vacation leave
  * Sick leave
  * Insurance benefits
  * Restaurant/lounge discounts
  * Golf/croquet privileges
  * Gift shop discounts
  * Exchange letters for ski resorts
  * FMLA and PLO leave options
- Don't just focus on one type of benefit unless specifically asked.
- For questions about employee conduct (drinking, dress code, etc.), include ALL relevant rules and restrictions.

Key Guidelines:
1. For policies: List ALL rules comprehensively
2. For benefits: Be comprehensive and helpful
3. Always include specific details (times, limits, locations)
4. Format responses for easy scanning and understanding
5. If unsure, direct to Human Resources contact`;

    // 메시지 구성
    const messagesForGPT = [
      { role: "system", content: systemPrompt }
    ];

    // 관련 컨텍스트가 있으면 시스템 메시지로 추가
    if (relevantContext) {
      // 질문 유형 감지
      const isBenefitQuestion = searchQuery.toLowerCase().includes('benefit') || 
                               searchQuery.toLowerCase().includes('혜택') ||
                               searchQuery.toLowerCase().includes('privilege') ||
                               searchQuery.toLowerCase().includes('특전');
      
      const isPolicyQuestion = searchQuery.toLowerCase().includes('drink') ||
                              searchQuery.toLowerCase().includes('bar') ||
                              searchQuery.toLowerCase().includes('lounge') ||
                              searchQuery.toLowerCase().includes('alcohol') ||
                              searchQuery.toLowerCase().includes('rule') ||
                              searchQuery.toLowerCase().includes('policy');
      
      let contextInstructions = `Employee Handbook Information:\n\n${relevantContext}\n\n`;
      
      if (isBenefitQuestion) {
        contextInstructions += `IMPORTANT: This is a general benefits question. Please provide a COMPREHENSIVE overview of ALL employee benefits mentioned in the handbook, not just the most relevant one. Include holidays, vacation, sick leave, insurance, discounts, privileges, etc. Organize the response with clear categories and translate naturally into the user's language.`;
      } else if (isPolicyQuestion) {
        contextInstructions += `IMPORTANT: This is a policy/rules question. Please provide a COMPLETE answer including:
1. What is ALLOWED (with specifics like limits, locations, times)
2. ALL restrictions and rules (don't miss any important details)
3. Any consequences for violations
Use clear formatting with ✅ for allowed actions and ❌ for restrictions. Be thorough and include ALL relevant rules from the handbook.`;
      } else {
        contextInstructions += `IMPORTANT: Translate this information naturally into the user's language when responding. Provide complete information with good formatting.`;
      }
      
      messagesForGPT.push({
        role: "system",
        content: contextInstructions
      });
    } else {
      // 관련 컨텍스트가 없는 경우
      messagesForGPT.push({
        role: "system",
        content: `Note: No relevant information found in the handbook for this query. Politely inform the user in their language that this information is not available in the handbook and suggest contacting HR directly.`
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