"""Language selection must take precedence over dialect and persona defaults."""

import pytest

from board_prompts import build_board_greeting, build_board_prompt, build_resume_greeting
from locale_map import DEFAULT_PROFILE


@pytest.mark.parametrize("persona", ["nova", "algo", "keerthi", "vikram"])
def test_default_teacher_does_not_force_a_regional_language(persona):
    prompt = build_board_prompt(DEFAULT_PROFILE, persona)

    assert "Switch languages only" in prompt
    assert "LAST sentence" not in prompt
    assert "Speak Telangana Telugu" not in prompt
    assert "Speak Hindi," not in prompt
    assert "# Register: Hyderabadi / Telangana Telugu" not in prompt
    assert "Initial session language: English" in prompt


@pytest.mark.parametrize("lang,name", [("en", "English"), ("hi", "Hindi"), ("ta", "Tamil"), ("kn", "Kannada")])
def test_other_selected_languages_do_not_load_the_telugu_dialect(lang, name):
    prompt = build_board_prompt(DEFAULT_PROFILE, "vikram", lang=lang)

    assert f"Initial session language: {name}" in prompt
    assert "# Register: Hyderabadi / Telangana Telugu" not in prompt


def test_explicit_telugu_selection_retains_its_dialect():
    prompt = build_board_prompt(DEFAULT_PROFILE, lang="te")

    assert "Initial session language: Telugu" in prompt
    assert "# Register: Hyderabadi / Telangana Telugu" in prompt


def test_greeting_and_resume_keep_the_selected_language_beyond_the_greeting():
    greeting = build_board_greeting(DEFAULT_PROFILE, "en")
    resumed = build_resume_greeting("en", "Student: Explain in Telugu", "old board")

    assert "Continue teaching in English" in greeting
    assert "Continue teaching in English" in resumed
    assert "Historical language choices do not override" in resumed


def test_interview_handoff_tool_does_not_override_language():
    from board_session import BoardTeacher

    tool = BoardTeacher.transfer_to_interview
    instructions = tool._func.__doc__
    assert "speaks Hindi" not in instructions
    assert "selected language" in instructions
