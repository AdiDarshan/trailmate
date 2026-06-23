"""TrailMate — Streamlit chat UI with a live trip notebook.

Layout:
- Left pane:  GPT-like chat with the TrailMate agent (multi-turn).
- Right pane: a notebook. One tab per day; each day shows four cards
              (Trail, Eat, Sleep, Weather) under a dated header.

The notebook reads ``.trailmate_current_trip.json`` (written by the
``save_itinerary`` tool) and re-renders after every agent turn.

Run with:
    streamlit run src/trailmate/ui/app.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

from trailmate.logging_config import configure_logging, get_logger

load_dotenv()
configure_logging()
logger = get_logger(__name__)

# ── Page config (must be the first Streamlit call) ──────────────────────────────

st.set_page_config(page_title="TrailMate", page_icon="🥾", layout="wide")

_ITINERARY_PATH = Path(__file__).parent.parent.parent.parent / ".trailmate_current_trip.json"

# ── Global styles — bright, friendly notebook ──────────────────────────────────

st.markdown(
    """
    <style>
    .stApp { background: #fffdf6; }

    /* Pane headers */
    .tm-pane-title { font-size: 1.35rem; font-weight: 800; margin: 0 0 2px 0; }
    .tm-pane-sub   { color: #6b7280; font-size: 0.85rem; margin-bottom: 8px; }

    /* Keep chat + notebook text readable on the light background */
    [data-testid="stChatMessage"] p,
    [data-testid="stChatMessage"] li,
    [data-testid="stChatMessage"] span,
    [data-testid="stMarkdownContainer"] p,
    [data-testid="stMarkdownContainer"] li { color: #1a1a1a; }

    /* Notebook day header */
    .tm-day-header {
        background: linear-gradient(90deg, #ffd54f 0%, #ffb74d 100%);
        color: #4e342e;
        border-radius: 14px;
        padding: 12px 18px;
        margin-bottom: 14px;
        font-weight: 800;
        font-size: 1.05rem;
        box-shadow: 0 2px 6px rgba(0,0,0,0.08);
    }
    .tm-day-header .tm-day-date { font-size: 0.8rem; font-weight: 600; opacity: 0.85; }

    /* Cards */
    .tm-card {
        border-radius: 14px;
        padding: 14px 16px;
        margin-bottom: 12px;
        line-height: 1.55;
        font-size: 0.9rem;
        box-shadow: 0 2px 6px rgba(0,0,0,0.06);
    }
    .tm-card-title {
        font-size: 0.82rem;
        font-weight: 800;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        margin-bottom: 8px;
    }
    .tm-card p { margin: 3px 0; }
    .tm-card a { text-decoration: none; font-weight: 700; }

    /* Bright card palette */
    .tm-trail   { background: #d7f9d0; border-left: 6px solid #2e9e2e; color: #14431a; }
    .tm-trail a { color: #14431a; }

    .tm-eat     { background: #ffe7b3; border-left: 6px solid #fb8c00; color: #6d3b00; }
    .tm-eat a   { color: #6d3b00; }

    .tm-sleep   { background: #f6cdf0; border-left: 6px solid #ab2ec0; color: #5a0a66; }
    .tm-sleep a { color: #5a0a66; }

    .tm-weather { background: #c5ecff; border-left: 6px solid #00a3e0; color: #053a52; }
    .tm-weather a { color: #053a52; }

    .tm-empty {
        text-align: center;
        color: #9aa0a6;
        padding: 70px 20px;
        font-size: 0.95rem;
        border: 2px dashed #e0ddd0;
        border-radius: 16px;
    }
    </style>
    """,
    unsafe_allow_html=True,
)

# ── Helpers (defined before use) ───────────────────────────────────────────────


def _load_itinerary() -> dict | None:
    try:
        return json.loads(_ITINERARY_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None


def _extract_pdfs(harness) -> list[str]:
    """Collect PDF paths produced by tools during the latest agent turn."""
    paths: list[str] = []
    for msg in reversed(harness.chat_history):
        if msg.get("role") == "tool":
            try:
                result = json.loads(msg["content"])
                if result.get("status") == "success" and str(result.get("path", "")).endswith(".pdf"):
                    paths.append(result["path"])
            except (json.JSONDecodeError, AttributeError, TypeError):
                pass
        elif msg.get("role") == "user":
            break
    return paths


def _link(text: str, url: str | None) -> str:
    if not url:
        return text
    return f'<a href="{url}" target="_blank">{text}</a>'


def _card(css_class: str, icon: str, title: str, body_html: str) -> str:
    return (
        f'<div class="tm-card {css_class}">'
        f'<div class="tm-card-title">{icon} {title}</div>'
        f"{body_html}"
        f"</div>"
    )


def _trail_card(trail: dict | None) -> str:
    if not trail:
        return _card("tm-trail", "🥾", "Where to Hike", "<p>No trail selected yet</p>")

    name = trail.get("name", "Trail")
    parts: list[str] = []

    nav = []
    if trail.get("start_maps"):
        nav.append(_link("📍 Maps", trail["start_maps"]))
    if trail.get("waze"):
        nav.append(_link("🧭 Waze", trail["waze"]))
    if nav:
        parts.append(f'<p>{" · ".join(nav)}</p>')

    meta = []
    if trail.get("distance_km"):
        meta.append(f'📏 {trail["distance_km"]} km')
    if trail.get("duration"):
        meta.append(f'⏱️ {trail["duration"]}')
    if trail.get("difficulty"):
        meta.append(f'💪 {trail["difficulty"]}')
    if meta:
        parts.append(f'<p>{" &nbsp;·&nbsp; ".join(meta)}</p>')

    if trail.get("description"):
        desc = trail["description"]
        desc = desc[:200] + ("…" if len(desc) > 200 else "")
        parts.append(f'<p style="margin-top:6px;font-style:italic;">{desc}</p>')

    if trail.get("tiuli_url"):
        parts.append(f'<p style="margin-top:6px;">{_link("🔗 Full guide on Tiuli", trail["tiuli_url"])}</p>')

    return _card("tm-trail", "🥾", "Where to Hike", "\n".join(parts) or "<p>No details</p>")


def _eat_card(day: dict) -> str:
    """One card covering both meals; spec asks for a single 'where to eat' card."""
    parts: list[str] = []
    for label, place in (("Lunch", day.get("lunch")), ("Dinner", day.get("dinner"))):
        if not place:
            continue
        name = place.get("name", "")
        line = f'<p><strong>{label}:</strong> {_link(name, place.get("maps"))}'
        if place.get("address"):
            line += f' <span style="opacity:.7">· {place["address"]}</span>'
        line += "</p>"
        parts.append(line)

    if not parts:
        parts.append("<p>No dining picks yet</p>")
    return _card("tm-eat", "🍽️", "Where to Eat", "\n".join(parts))


def _sleep_card(hotel: dict | None) -> str:
    if not hotel:
        return _card("tm-sleep", "🏨", "Where to Sleep", "<p>No accommodation yet</p>")
    parts = [f'<p>{_link(hotel.get("name", ""), hotel.get("maps"))}</p>']
    if hotel.get("address"):
        parts.append(f'<p style="opacity:.75">{hotel["address"]}</p>')
    return _card("tm-sleep", "🏨", "Where to Sleep", "\n".join(parts))


def _weather_card(day: dict) -> str:
    parts: list[str] = []
    if day.get("weather"):
        parts.append(f'<p>🌤️ {day["weather"]}</p>')
    if day.get("weather_note"):
        parts.append(f'<p>⚠️ <strong>{day["weather_note"]}</strong></p>')
    return _card("tm-weather", "🌡️", "Weather", "\n".join(parts) or "<p>No forecast yet</p>")


def _render_notebook(itinerary: dict) -> None:
    title = itinerary.get("title", "Your Trip")
    dates = itinerary.get("dates", "")
    st.markdown(f'<div class="tm-pane-title">📓 {title}</div>', unsafe_allow_html=True)
    if dates:
        st.markdown(f'<div class="tm-pane-sub">{dates}</div>', unsafe_allow_html=True)

    days: list[dict] = itinerary.get("days", [])
    if not days:
        st.markdown('<div class="tm-empty">No day data found yet.</div>', unsafe_allow_html=True)
        return

    tab_labels = [f"Day {d.get('day_number', i + 1)}" for i, d in enumerate(days)]
    tabs = st.tabs(tab_labels)

    for tab, day in zip(tabs, days):
        with tab:
            day_no = day.get("day_number", "")
            date_str = day.get("date", "")
            st.markdown(
                f'<div class="tm-day-header">Day {day_no}'
                f'<div class="tm-day-date">{date_str}</div></div>',
                unsafe_allow_html=True,
            )
            st.markdown(_trail_card(day.get("trail")), unsafe_allow_html=True)
            st.markdown(_eat_card(day), unsafe_allow_html=True)
            st.markdown(_sleep_card(day.get("hotel")), unsafe_allow_html=True)
            st.markdown(_weather_card(day), unsafe_allow_html=True)


# ── Session state ──────────────────────────────────────────────────────────────

if "harness" not in st.session_state:
    from trailmate.agent_harness import AgentHarness

    st.session_state.harness = AgentHarness()
    # Fresh session — drop any itinerary left over from a previous run.
    _ITINERARY_PATH.unlink(missing_ok=True)

if "messages" not in st.session_state:
    st.session_state.messages = []  # {"role", "content", "pdfs"}

if "pending" not in st.session_state:
    st.session_state.pending = None  # a user prompt awaiting an agent reply

# ── Chat input (top level so Streamlit pins it to the page bottom) ─────────────

prompt = st.chat_input("Where do you want to travel? e.g. 'Plan a trip in the Galilee'")

if prompt:
    if not os.getenv("OPENAI_API_KEY"):
        st.error("OPENAI_API_KEY is not set. Add it to your .env file and restart.")
        st.stop()
    # Show the user's message right away: store it, mark it pending, and rerun
    # so the chat repaints before the (blocking) agent call begins.
    st.session_state.messages.append({"role": "user", "content": prompt})
    st.session_state.pending = prompt
    st.rerun()

# ── Two-pane layout ────────────────────────────────────────────────────────────

col_chat, col_notebook = st.columns([1.05, 1], gap="large")

# Render the notebook FIRST so the existing plan stays on screen while the agent
# is thinking. It refreshes on the rerun that follows each completed turn.
with col_notebook:
    itinerary = _load_itinerary()
    if itinerary:
        _render_notebook(itinerary)
    else:
        st.markdown('<div class="tm-pane-title">📓 Trip Notebook</div>', unsafe_allow_html=True)
        st.markdown(
            '<div class="tm-empty">'
            "🗺️<br><br>"
            "Your day-by-day plan will appear here once TrailMate finishes planning.<br>"
            "Try: <em>\"Plan 2 days in the Galilee starting this Saturday\"</em>"
            "</div>",
            unsafe_allow_html=True,
        )

with col_chat:
    st.markdown('<div class="tm-pane-title">🥾 TrailMate</div>', unsafe_allow_html=True)
    st.markdown(
        '<div class="tm-pane-sub">Your AI travel companion for Israel. '
        "Ask me to plan a trip anywhere in the country.</div>",
        unsafe_allow_html=True,
    )

    if not st.session_state.messages:
        with st.chat_message("assistant", avatar="🥾"):
            st.markdown(
                "Hi! I'm TrailMate. Tell me where you'd like to go and I'll plan it out — "
                "for example, *“Plan a trip in the Galilee.”*"
            )

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

    # A prompt is waiting: run the agent now, inside an assistant bubble, so the
    # spinner appears directly under the user's just-shown message.
    if st.session_state.pending:
        with st.chat_message("assistant", avatar="🥾"):
            with st.spinner("TrailMate is planning…"):
                logger.info("UI received prompt: %r", st.session_state.pending)
                try:
                    response = st.session_state.harness.run(st.session_state.pending)
                    logger.info("UI returning response (%d chars)", len(response))
                except Exception as e:  # noqa: BLE001 — surface any failure to the user
                    logger.exception("UI run failed")
                    response = f"Something went wrong: {e}"
            pdfs = _extract_pdfs(st.session_state.harness)

        st.session_state.messages.append(
            {"role": "assistant", "content": response, "pdfs": pdfs}
        )
        st.session_state.pending = None
        # Rerun so the answer renders as a normal message and the notebook refreshes.
        st.rerun()
