import openai
import json
import os
from pathlib import Path
from uuid import uuid4
from dotenv import load_dotenv
import tiktoken
import re

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

def smart_split_text(text, max_tokens=1500, overlap_tokens=100):
    """의미 단위로 텍스트를 지능적으로 분할"""
    
    # 섹션 헤더 패턴
    section_patterns = [
        r'^[A-Z\s]+$',  # 모두 대문자로 된 라인
        r'^#+\s+',      # 마크다운 헤더
        r'^\d+\.\s+',   # 번호가 매겨진 섹션
        r'^•\s+',       # 불릿 포인트
        r'^-\s+',       # 대시 리스트
    ]
    
    # 줄 단위로 분할
    lines = text.split('\n')
    
    chunks = []
    current_chunk = []
    current_tokens = 0
    current_section = ""
    
    for i, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue
            
        # 섹션 헤더인지 확인
        is_header = any(re.match(pattern, line) for pattern in section_patterns)
        
        # 토큰 수 계산
        line_tokens = count_tokens(line)
        
        # 새로운 섹션 시작 또는 토큰 한계 도달
        if is_header or (current_tokens + line_tokens > max_tokens and current_chunk):
            # 현재 청크 저장
            if current_chunk:
                chunk_text = '\n'.join(current_chunk)
                chunks.append({
                    'text': chunk_text,
                    'section': current_section,
                    'tokens': current_tokens
                })
            
            # 새 청크 시작
            current_chunk = []
            current_tokens = 0
            
            # 헤더인 경우 섹션 이름 업데이트
            if is_header:
                current_section = line
        
        # 현재 라인 추가
        current_chunk.append(line)
        current_tokens += line_tokens
    
    # 마지막 청크 저장
    if current_chunk:
        chunk_text = '\n'.join(current_chunk)
        chunks.append({
            'text': chunk_text,
            'section': current_section,
            'tokens': current_tokens
        })
    
    return chunks

def create_semantic_chunks(text):
    """의미론적으로 관련된 내용끼리 묶어서 청크 생성"""
    
    # 특정 섹션별로 분리
    sections = {
        'employee_benefits': [
            'EMPLOYEE BENEFITS AND LEAVE',
            'Holidays',
            'Vacation Leave',
            'Sick Leave',
            'Insurance Benefits',
            'Flexible Spending',
            'OregonSaves'
        ],
        'employee_privileges': [
            'EMPLOYEE PRIVILEGES',
            'Restaurants',
            'Lounges',
            'Golf/Croquet',
            'Gift Shop',
            'Exchange Letter'
        ],
        'leave_policies': [
            'Personal Leaves',
            'Bereavement Leave',
            'Family Medical Leave',
            'Paid Leave Oregon',
            'Jury Duty',
            'Workers Compensation'
        ]
    }
    
    chunks = []
    
    # 각 섹션별로 관련 내용 추출
    for category, keywords in sections.items():
        for keyword in keywords:
            # 대소문자 구분 없이 검색
            pattern = re.compile(f'{re.escape(keyword)}.*?(?=(?:{"|".join(keywords)})|$)', 
                               re.IGNORECASE | re.DOTALL)
            matches = pattern.findall(text)
            
            for match in matches:
                if match and count_tokens(match) < 2000:
                    chunks.append({
                        'text': match.strip(),
                        'category': category,
                        'keyword': keyword
                    })
    
    return chunks

# 텍스트 로드
text = Path("guide_optimized_full.txt").read_text(encoding="utf-8")

# 두 가지 방식으로 청크 생성
print("스마트 분할 방식으로 청크 생성 중...")
smart_chunks = smart_split_text(text, max_tokens=1500)

print("의미론적 청크 생성 중...")
semantic_chunks = create_semantic_chunks(text)

# 모든 청크 결합
all_chunks = []

# 스마트 청크 추가
for chunk in smart_chunks:
    all_chunks.append({
        'text': chunk['text'],
        'metadata': {
            'type': 'smart_split',
            'section': chunk['section'],
            'tokens': chunk['tokens']
        }
    })

# 의미론적 청크 추가
for chunk in semantic_chunks:
    all_chunks.append({
        'text': chunk['text'],
        'metadata': {
            'type': 'semantic',
            'category': chunk['category'],
            'keyword': chunk['keyword']
        }
    })

print(f"총 {len(all_chunks)}개의 청크가 생성되었습니다.")

# 벡터 생성
vector_data = []

for i, chunk in enumerate(all_chunks):
    try:
        print(f"청크 {i+1}/{len(all_chunks)} 처리 중...")
        
        # chat.js와 동일한 모델 사용
        res = openai.embeddings.create(
            model="text-embedding-ada-002",  # chat.js와 동일한 모델
            input=chunk['text']
        )
        
        vector = res.data[0].embedding
        vector_data.append({
            "id": str(uuid4()),
            "text": chunk['text'],  # chat.js에서 'text' 필드를 사용
            "embedding": vector,
            "metadata": chunk['metadata']
        })
        
    except Exception as e:
        print(f"청크 {i+1} 처리 중 오류 발생: {e}")
        continue

print(f"총 {len(vector_data)}개의 벡터 데이터가 생성되었습니다.")

# 직원 혜택 관련 청크 확인
benefit_chunks = [v for v in vector_data 
                 if 'employee' in v['text'].lower() and 
                    ('benefit' in v['text'].lower() or 'privilege' in v['text'].lower())]
print(f"직원 혜택 관련 청크: {len(benefit_chunks)}개")

# JSON 저장
output_path = os.path.join(current_dir, "public", "guide_vectors.json")
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(vector_data, f, indent=2, ensure_ascii=False)

print(f"{output_path} 파일이 생성되었습니다.")

# 테스트: 직원 혜택 관련 내용이 포함되었는지 확인
test_queries = [
    "직원혜택",
    "employee benefits",
    "vacation",
    "holiday pay",
    "restaurant discount"
]

print("\n=== 테스트 쿼리 결과 ===")
for query in test_queries:
    matching_chunks = [v for v in vector_data if query.lower() in v['text'].lower()]
    print(f"{query}: {len(matching_chunks)}개 청크에서 발견")