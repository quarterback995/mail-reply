Build a full-stack web application named "Mail-Reply-Agent" using React (frontend) and FastAPI (backend). The purpose of this tool is to help users generate email replies that match their personal writing style based on uploaded historical data and reference documents.
Core Functional Requirements:
Data Management Dashboard: Create an interface for users to upload two types of data: (a) "Style Data" consisting of pairs of received emails and their corresponding manual replies, and (b) "Knowledge Data" such as PDFs or text files containing reference materials (e.g., restaurant menus or business policies). Use ChromaDB as the vector store to manage these embeddings.
Dual-Stream RAG Implementation: Implement a retrieval logic that, upon receiving a new email, fetches the most relevant style samples (few-shot examples) and the most relevant factual information from the knowledge base.
The Workspace UI: The main interface should feature a split-screen layout. The left pane is for pasting the incoming "New Email." The right pane displays the "AI Generated Draft" with an "Edit" and "Copy" button.
Style Alignment Logic: Use a system prompt that enforces strict adherence to the user's tone, vocabulary, and formatting habits extracted from the uploaded style data.
UI/UX Requirements:
Use a clean, modern, and engineering-oriented aesthetic with Tailwind CSS (dark mode support).
Include a sidebar for navigation between "Data Library" and "Drafting Workspace."
Provide visual feedback (loading states/progress bars) during document embedding and reply generation.
Ensure the layout is responsive and professional.
Technical Stack Integration:
Backend: Python, FastAPI, LangChain/LangGraph, and OpenAI/Anthropic API integration.
Frontend: Vite + React, Tailwind CSS, and Axios for API communication.
