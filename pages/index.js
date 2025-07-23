import { useState, useRef, useEffect } from "react";

export default function Home() {
  const [input, setInput] = useState("");
  const [chat, setChat] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const chatContainerRef = useRef(null);

  useEffect(() => {
    chatContainerRef.current?.scrollTo({
      top: chatContainerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chat]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    setIsLoading(true);

    const updatedChat = [...chat, { role: "user", content: input }];

    try {
      const res = await fetch('/api/chat', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updatedChat }),
      });

      const data = await res.json();
      setChat([...updatedChat, data.choices[0].message]);
    } catch (err) {
      setChat([...updatedChat, { role: "assistant", content: "⚠️ 오류가 발생했습니다." }]);
    }

    setInput("");
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-start p-6">
      <div className="w-full max-w-2xl bg-white shadow-lg rounded-xl p-6">
        <h1 className="text-2xl font-bold text-center mb-4 text-blue-700">📘 MHOR HR ChatBot</h1>

        <div className="h-80 overflow-y-auto border rounded-md p-4 mb-4 space-y-2 bg-gray-50" ref={chatContainerRef}>
          {chat.map((msg, i) => (
            <div
              key={i}
              className={`p-3 rounded-lg max-w-[80%] ${
                msg.role === "user"
                  ? "bg-blue-100 self-end ml-auto text-right"
                  : "bg-green-100 self-start mr-auto text-left"
              }`}
            >
              <strong>{msg.role === "user" ? "You" : "HRBot"}:</strong> {msg.content}
            </div>
          ))}
        </div>

        {isLoading && (
          <p className="text-sm text-gray-500 text-center mb-4">⏳ 응답을 기다리는 중...</p>
        )}

        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="질문을 입력하세요"
            className="flex-grow p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <button
            onClick={handleSend}
            disabled={isLoading}
            className={`$${
              isLoading ? "bg-blue-300 cursor-not-allowed" : "bg-blue-500 hover:bg-blue-600"
            } text-white px-4 py-2 rounded-md`}
          >
            {isLoading ? "전송 중..." : "전송"}
          </button>
        </div>
      </div>
    </div>
  );
}
