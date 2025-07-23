import openai
import json
import os
from pathlib import Path
from uuid import uuid4
from dotenv import load_dotenv
import tiktoken

# .env 파일에서 환경변수 로드
current_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(current_dir, ".env.local")
load_dotenv(dotenv_path=env_path, encoding="utf-8")

# 환경변수에서 API 키 가져오기
openai.api_key = os.getenv("OPENAI_API_KEY")

# 토큰 계산용 인코더
encoding = tiktoken.get_encoding("cl100k_base")

def count_tokens(text):
    """텍스트의 토큰 수 계산"""
    return len(encoding.encode(text))

def split_text_by_tokens(text, max_tokens=7000):
    """텍스트를 토큰 기준으로 분할"""
    sentences = text.split('.')
    chunks = []
    current_chunk = ""
    
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
            
        # 마침표 복원
        sentence = sentence + '.'
        
        # 현재 청크에 추가했을 때의 토큰 수 확인
        test_chunk = current_chunk + " " + sentence if current_chunk else sentence
        
        if count_tokens(test_chunk) <= max_tokens:
            current_chunk = test_chunk
        else:
            # 현재 청크가 비어있지 않으면 저장
            if current_chunk:
                chunks.append(current_chunk)
            current_chunk = sentence
    
    # 마지막 청크 추가
    if current_chunk:
        chunks.append(current_chunk)
    
    return chunks

# 최적화된 텍스트 로드
text = Path("guide_optimized_full.txt").read_text(encoding="utf-8")
initial_chunks = [c.strip() for c in text.split("\n\n") if c.strip()]

# 각 청크의 토큰 수 확인 후 필요시 분할
processed_chunks = []
for chunk in initial_chunks:
    token_count = count_tokens(chunk)
    print(f"청크 토큰 수: {token_count}")
    
    if token_count > 7000:  # 안전 마진을 위해 7000 토큰 제한
        print(f"청크가 너무 큼 ({token_count} 토큰), 분할합니다.")
        sub_chunks = split_text_by_tokens(chunk, max_tokens=7000)
        processed_chunks.extend(sub_chunks)
    else:
        processed_chunks.append(chunk)

# 처리된 청크 개수 제한
processed_chunks = processed_chunks[:100]

print(f"총 {len(processed_chunks)}개의 청크를 처리합니다.")

vector_data = []

for i, chunk in enumerate(processed_chunks):
    try:
        print(f"청크 {i+1}/{len(processed_chunks)} 처리 중... (토큰 수: {count_tokens(chunk)})")
        
        res = openai.embeddings.create(
            model="text-embedding-3-small",
            input=chunk
        )
        vector = res.data[0].embedding
        vector_data.append({
            "id": str(uuid4()),
            "content": chunk,
            "embedding": vector
        })
        
    except Exception as e:
        print(f"청크 {i+1} 처리 중 오류 발생: {e}")
        print(f"문제가 된 청크 길이: {len(chunk)} 문자, {count_tokens(chunk)} 토큰")
        continue

print(f"총 {len(vector_data)}개의 벡터 데이터가 생성되었습니다.")

with open("guide_vectors.json", "w", encoding="utf-8") as f:
    json.dump(vector_data, f, indent=2, ensure_ascii=False)

print("guide_vectors.json 파일이 생성되었습니다.")