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
    try {
      const embedding = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: lastUserMessage.content,
      });

      // 벡터 로드 및 유사도 검색
      const vectors = loadVectors();
      if (vectors.length > 0) {
        const similarities = vectors.map(item => ({
          ...item,
          similarity: cosineSimilarity(embedding.data[0].embedding, item.embedding)
        }));

        // 상위 3개 가장 유사한 문서 선택
        const topMatches = similarities
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 3);

        relevantContext = topMatches
          .map(match => `관련 정보: ${match.text}`)
          .join('\n\n');
      }
    } catch (embeddingError) {
      console.error('Embedding error:', embeddingError);
      // 임베딩 실패시에도 계속 진행
    }

    // 언어별 시스템 프롬프트
    const systemPrompts = {
      ko: `당신은 MHOR(가상의 회사)의 전문적이고 친근한 HR 어시스턴트입니다. 

주요 역할:
- 직원들의 HR 관련 질문에 정확하고 도움이 되는 답변 제공
- 회사 정책, 복리후생, 급여, 휴가, 교육 등에 대한 안내
- 따뜻하고 이해심 많은 톤으로 소통
- 복잡한 정책을 쉽게 설명

답변 스타일:
- 친근하면서도 전문적인 톤 유지
- 구체적이고 실행 가능한 조언 제공
- 필요시 추가 문의를 위한 연락처나 절차 안내
- 항상 직원의 입장에서 생각하고 도움이 되는 방향으로 답변

${relevantContext ? `\n참고할 회사 정보:\n${relevantContext}` : ''}`,

      en: `You are a professional and friendly HR Assistant for MHOR (a virtual company).

Key responsibilities:
- Provide accurate and helpful answers to employee HR-related questions  
- Guide on company policies, benefits, payroll, leave, training, etc.
- Communicate with a warm and understanding tone
- Explain complex policies in simple terms

Response style:
- Maintain a friendly yet professional tone
- Provide specific and actionable advice
- Guide to contacts or procedures for additional inquiries when needed
- Always think from the employee's perspective and respond helpfully

${relevantContext ? `\nCompany information for reference:\n${relevantContext}` : ''}`,

      es: `Eres un Asistente de RRHH profesional y amigable para MHOR (una empresa virtual).

Responsabilidades principales:
- Proporcionar respuestas precisas y útiles a preguntas relacionadas con RRHH
- Orientar sobre políticas de empresa, beneficios, nómina, permisos, formación, etc.
- Comunicarte con un tono cálido y comprensivo
- Explicar políticas complejas en términos simples

${relevantContext ? `\nInformación de la empresa para referencia:\n${relevantContext}` : ''}`,

      fr: `Vous êtes un Assistant RH professionnel et convivial pour MHOR (une entreprise virtuelle).

Responsabilités principales:
- Fournir des réponses précises et utiles aux questions liées aux RH
- Guider sur les politiques d'entreprise, avantages, paie, congés, formation, etc.
- Communiquer avec un ton chaleureux et compréhensif
- Expliquer les politiques complexes en termes simples

${relevantContext ? `\nInformations de l'entreprise pour référence:\n${relevantContext}` : ''}`,

      de: `Sie sind ein professioneller und freundlicher HR-Assistent für MHOR (ein virtuelles Unternehmen).

Hauptverantwortlichkeiten:
- Genaue und hilfreiche Antworten auf HR-bezogene Fragen der Mitarbeiter
- Beratung zu Unternehmensrichtlinien, Vorteilen, Gehaltsabrechnung, Urlaub, Schulungen usw.
- Kommunikation mit warmem und verständnisvollem Ton
- Erklärung komplexer Richtlinien in einfachen Begriffen

${relevantContext ? `\nUnternehmensinformationen zur Referenz:\n${relevantContext}` : ''}`,

      ja: `あなたはMHOR（仮想企業）の専門的で親しみやすいHRアシスタントです。

主な責任:
- 従業員のHR関連質問に正確で有用な回答を提供
- 会社の方針、福利厚生、給与、休暇、研修などについてガイダンス
- 温かく理解のあるトーンでコミュニケーション
- 複雑な方針を簡単な言葉で説明

${relevantContext ? `\n参考となる会社情報:\n${relevantContext}` : ''}`,

      zh: `您是MHOR（虚拟公司）专业友好的HR助理。

主要职责:
- 为员工的HR相关问题提供准确有用的答案
- 指导公司政策、福利、薪资、休假、培训等
- 以温暖理解的语调沟通
- 用简单术语解释复杂政策

${relevantContext ? `\n参考公司信息:\n${relevantContext}` : ''}`
    };

    const systemPrompt = systemPrompts[detectedLanguage] || systemPrompts.en;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ],
      temperature: 0.7,
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