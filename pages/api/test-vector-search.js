// test-vector-search.js
// 이 파일을 pages/api/ 폴더에 넣고 테스트하세요

import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  try {
    // 벡터 파일 로드
    const vectorPath = path.join(process.cwd(), 'public', 'guide_vectors.json');
    
    // 파일 존재 확인
    if (!fs.existsSync(vectorPath)) {
      return res.status(404).json({ 
        error: 'Vector file not found',
        path: vectorPath 
      });
    }
    
    const vectorData = fs.readFileSync(vectorPath, 'utf8');
    const vectors = JSON.parse(vectorData);
    
    // 직원 혜택 관련 청크 찾기
    const benefitChunks = vectors.filter(item => {
      const text = item.text || item.content || '';
      const lowerText = text.toLowerCase();
      
      return (
        lowerText.includes('employee benefits') ||
        lowerText.includes('employee privileges') ||
        lowerText.includes('vacation') ||
        lowerText.includes('holiday') ||
        lowerText.includes('insurance') ||
        lowerText.includes('discount') ||
        lowerText.includes('직원 혜택') ||
        lowerText.includes('복리후생')
      );
    });
    
    // 결과 요약
    const summary = {
      totalVectors: vectors.length,
      benefitRelatedChunks: benefitChunks.length,
      sampleChunks: benefitChunks.slice(0, 3).map(chunk => ({
        text: (chunk.text || chunk.content || '').substring(0, 200) + '...',
        metadata: chunk.metadata
      })),
      fieldNames: vectors.length > 0 ? Object.keys(vectors[0]) : []
    };
    
    // 특정 키워드 검색
    const keywords = ['holidays', 'vacation leave', 'sick leave', 'restaurants', 'golf'];
    const keywordResults = {};
    
    keywords.forEach(keyword => {
      const found = vectors.filter(item => {
        const text = item.text || item.content || '';
        return text.toLowerCase().includes(keyword);
      });
      keywordResults[keyword] = found.length;
    });
    
    res.status(200).json({
      summary,
      keywordResults,
      message: 'Vector search test completed'
    });
    
  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      stack: error.stack 
    });
  }
}