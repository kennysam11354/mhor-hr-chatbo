import { useState, useRef, useEffect } from "react";

export default function Home() {
  const [input, setInput] = useState("");
  const [chat, setChat] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showClearButton, setShowClearButton] = useState(false);
  const chatContainerRef = useRef(null);

  // 페이지 로드시 저장된 대화 불러오기
  useEffect(() => {
    const savedChat = localStorage.getItem('mhor-chat-history');
    if (savedChat) {
      try {
        const parsedChat = JSON.parse(savedChat);
        setChat(parsedChat);
        setShowClearButton(parsedChat.length > 0);
      } catch (error) {
        console.error('대화 불러오기 실패:', error);
        localStorage.removeItem('mhor-chat-history');
      }
    }
  }, []);

  // 대화가 변경될 때마다 localStorage에 저장
  useEffect(() => {
    if (chat.length > 0) {
      localStorage.setItem('mhor-chat-history', JSON.stringify(chat));
      setShowClearButton(true);
    } else {
      setShowClearButton(false);
    }
  }, [chat]);

  useEffect(() => {
    chatContainerRef.current?.scrollTo({
      top: chatContainerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chat]);

  // 대화 삭제 함수
  const clearChat = () => {
    if (window.confirm('Are you sure you want to clear all chat history?')) {
      setChat([]);
      localStorage.removeItem('mhor-chat-history');
      setShowClearButton(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    setIsLoading(true);

    const updatedChat = [...chat, { role: "user", content: input }];
    setChat(updatedChat);

    try {
      const res = await fetch('/api/chat', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updatedChat }),
      });

      const data = await res.json();
      setChat([...updatedChat, data.choices[0].message]);
    } catch (err) {
      setChat([...updatedChat, { role: "assistant", content: "⚠️ An error occurred." }]);
    }

    setInput("");
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header - 고정된 헤더 with Clear Button */}
      <div className="bg-white shadow-sm border-b px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg sm:text-2xl font-bold text-blue-700">
            📘 MHOR HR ChatBot
          </h1>
          {showClearButton && (
            <button
              onClick={clearChat}
              className="text-xs sm:text-sm bg-red-500 hover:bg-red-600 text-white px-2 py-1 sm:px-3 sm:py-1 rounded-md transition-colors"
              title="Clear chat history"
            >
              <span className="hidden sm:inline">🗑️ Clear Chat</span>
              <span className="sm:hidden">🗑️</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Chat Container - 반응형 설계 */}
      <div className="flex-1 flex flex-col px-2 py-2 sm:px-6 sm:py-4 max-w-4xl mx-auto w-full">
        
        {/* Chat Messages Area - 스마트폰에 최적화된 높이 */}
        <div 
          className="flex-1 overflow-y-auto border rounded-lg p-3 sm:p-4 mb-3 sm:mb-4 space-y-2 bg-gray-50 min-h-[60vh] max-h-[70vh]" 
          ref={chatContainerRef}
        >
          {chat.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <div className="text-4xl sm:text-6xl mb-4">💬</div>
              <p className="text-sm sm:text-base text-center px-4">
                Welcome to MHOR HR Assistant!<br />
                Ask me anything about HR policies, benefits, or workplace support.
              </p>
              <p className="text-xs sm:text-sm text-center px-4 mt-2 text-gray-400">
                💾 Your conversations will be saved automatically
              </p>
            </div>
          )}
          
          {chat.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} mb-2`}
            >
              <div
                className={`p-3 rounded-lg max-w-[85%] sm:max-w-[75%] break-words ${
                  msg.role === "user"
                    ? "bg-blue-500 text-white rounded-br-sm"
                    : "bg-white border shadow-sm rounded-bl-sm"
                }`}
              >
                <div className={`text-xs opacity-70 mb-1 ${msg.role === "user" ? "text-blue-100" : "text-gray-500"}`}>
                  {msg.role === "user" ? "You" : "HR Assistant"}
                </div>
                <div className="text-sm sm:text-base leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex items-center justify-center py-2 mb-2">
            <div className="flex items-center space-x-2 text-gray-500">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
              <span className="text-sm">HR Assistant is typing...</span>
            </div>
          </div>
        )}

        {/* Input Area - 스마트폰에 최적화 */}
        <div className="bg-white rounded-lg border shadow-sm p-3 sm:p-4">
          <div className="flex gap-2 sm:gap-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder="Type your HR question here..."
              className="flex-1 p-3 sm:p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent text-sm sm:text-base resize-none"
              disabled={isLoading}
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className={`px-4 sm:px-6 py-3 rounded-lg font-medium text-sm sm:text-base transition-colors ${
                isLoading || !input.trim()
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed" 
                  : "bg-blue-500 hover:bg-blue-600 text-white shadow-sm hover:shadow-md"
              }`}
            >
              <span className="hidden sm:inline">
                {isLoading ? "Sending..." : "Send"}
              </span>
              <span className="sm:hidden">
                {isLoading ? "..." : "→"}
              </span>
            </button>
          </div>
          
          {/* Helper text - 저장 상태 표시 추가 */}
          <div className="hidden sm:block mt-2 text-xs text-gray-500 text-center">
            Press Enter to send • Ask about policies, benefits, payroll, or workplace support
            {chat.length > 0 && <span className="ml-2">💾 Chat history saved automatically</span>}
          </div>
        </div>
      </div>
    </div>
  );
}