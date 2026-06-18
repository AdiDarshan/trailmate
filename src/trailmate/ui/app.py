"""TrailMate — Streamlit chat UI.

Run with:
    streamlit run app.py
"""

import json
import os

import streamlit as st
from dotenv import load_dotenv

load_dotenv()

# ── Page config ────────────────────────────────────────────────────────────────

st.set_page_config(
    page_title="TrailMate",
    page_icon="🥾",
    layout="centered",
)

st.title("🥾 TrailMate")
st.caption("Your AI travel companion for Israel. Ask me to plan a trip anywhere in the country.")

# ── Session state ──────────────────────────────────────────────────────────────

if "harness" not in st.session_state:
    from trailmate.agent_harness import AgentHarness
    st.session_state.harness = AgentHarness()

if "messages" not in st.session_state:
    st.session_state.messages = []  # {"role": "user"|"assistant", "content": str, "pdfs": [...]}


def _extract_pdfs(harness) -> list[str]:
    """Return paths of PDFs exported in the most recent agent turn."""
    paths = []
    # Walk chat history in reverse to find tool results from this turn
    for msg in reversed(harness.chat_history):
        if msg.get("role") == "tool":
            try:
                result = json.loads(msg["content"])
                if result.get("status") == "success" and result.get("path", "").endswith(".pdf"):
                    paths.append(result["path"])
            except (json.JSONDecodeError, AttributeError):
                pass
        elif msg.get("role") == "user":
            break  # stop at the user message that started this turn
    return paths

# ── Render existing conversation ───────────────────────────────────────────────

for msg in st.session_state.messages:
    with st.chat_message(msg["role"], avatar="🧑" if msg["role"] == "user" else "🥾"):
        st.markdown(msg["content"])
        for pdf_path in msg.get("pdfs", []):
            if os.path.exists(pdf_path):
                with open(pdf_path, "rb") as f:
                    st.download_button(
                        label=f"⬇️ Download {os.path.basename(pdf_path)}",
                        data=f.read(),
                        file_name=os.path.basename(pdf_path),
                        mime="application/pdf",
                        key=pdf_path,
                    )

# ── Chat input ─────────────────────────────────────────────────────────────────

if prompt := st.chat_input("Where do you want to travel?"):

    # Check for API key before doing anything
    if not os.getenv("OPENAI_API_KEY"):
        st.error("OPENAI_API_KEY is not set. Add it to your .env file and restart.")
        st.stop()

    # Show user message immediately
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user", avatar="🧑"):
        st.markdown(prompt)

    # Run the agent
    with st.chat_message("assistant", avatar="🥾"):
        with st.spinner("Planning your trip..."):
            try:
                response = st.session_state.harness.run(prompt)
            except Exception as e:
                response = f"Something went wrong: {e}"

        st.markdown(response)

        # Offer download buttons for any PDFs exported in this turn
        pdfs = _extract_pdfs(st.session_state.harness)
        for pdf_path in pdfs:
            if os.path.exists(pdf_path):
                with open(pdf_path, "rb") as f:
                    st.download_button(
                        label=f"⬇️ Download {os.path.basename(pdf_path)}",
                        data=f.read(),
                        file_name=os.path.basename(pdf_path),
                        mime="application/pdf",
                        key=f"new_{pdf_path}",
                    )

    st.session_state.messages.append({"role": "assistant", "content": response, "pdfs": pdfs})

    # ── Debug: tool call log ───────────────────────────────────────────────
    with st.expander("🔍 Tool calls (debug)", expanded=False):
        for entry in st.session_state.harness.trajectory_log[-10:]:
            iteration = entry.get("iteration")
            msg = entry.get("response", {})
            tool_calls = msg.get("tool_calls") or []
            if tool_calls:
                for tc in tool_calls:
                    fn = tc.get("function", {})
                    st.code(
                        f"[iter {iteration}] {fn.get('name')}({fn.get('arguments')})",
                        language="text",
                    )
            else:
                st.caption(f"[iter {iteration}] final answer (no tool calls)")
