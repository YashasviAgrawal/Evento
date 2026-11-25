"""Task 4 - First LangChain chatbot (question answering)."""
import os
import sys

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

# Load OPENAI_API_KEY (and optional OPENAI_MODEL) from .env, never hard-coded.
load_dotenv()

api_key = os.getenv("OPENAI_API_KEY")
if not api_key or api_key == "your_openai_api_key_here":
    sys.exit("OPENAI_API_KEY is missing. Put your key in GenAI_Learning/.env")

# Initialize the model (pick one your account can use; check pricing first)
llm = ChatOpenAI(
    model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
    temperature=0.7,
)

# Accept user input
question = input("Ask a question: ").strip()
if not question:
    sys.exit("Please type a question.")

# Invoke the model: .invoke() sends the prompt and returns an AIMessage
response = llm.invoke(question)

# Print only the text of the reply
print(response.content)
