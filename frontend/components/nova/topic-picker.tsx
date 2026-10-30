'use client';

import { useState } from 'react';
import { useT } from './i18n';

export function TopicPicker({
  connected,
  error,
  onChoose,
  onCancel,
  onRetry,
}: {
  connected: boolean;
  error: string | null;
  onChoose: (topic: string) => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const t = useT();
  const [topic, setTopic] = useState('');
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="flex min-h-svh items-center justify-center bg-[#F6F1E9] px-5 py-10">
      <section
        className="w-full max-w-lg rounded-3xl border border-[#E8DFD2] bg-[#FFFDFA] p-7 sm:p-10"
        aria-labelledby="topic-title"
      >
        <p role="status" className="mb-8 flex items-center gap-2 text-sm text-[#665B52]">
          <span
            aria-hidden
            className={`size-2 rounded-full ${error ? 'bg-[#B5695F]' : connected ? 'bg-[#6F9E82]' : 'bg-[#C89B4A]'}`}
          />
          {error ? t.topicConnectionFailed : connected ? t.topicConnected : t.topicConnecting}
        </p>
        <h1 id="topic-title" className="text-3xl font-semibold tracking-tight text-[#4A4038]">
          {t.topicTitle}
        </h1>
        <p className="mt-3 mb-7 text-base leading-relaxed text-[#665B52]">{t.topicBody}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!topic.trim()) {
              setInvalid(true);
              return;
            }
            if (connected && !error) onChoose(topic.trim());
          }}
        >
          <label htmlFor="lesson-topic" className="mb-2 block text-sm font-semibold text-[#4A4038]">
            {t.topicLabel}
          </label>
          <input
            id="lesson-topic"
            autoFocus
            value={topic}
            maxLength={160}
            onChange={(e) => {
              setTopic(e.target.value);
              setInvalid(false);
            }}
            aria-invalid={invalid}
            aria-describedby={invalid ? 'topic-error' : undefined}
            placeholder={t.topicPlaceholder}
            className="w-full rounded-xl border border-[#C6BAAC] bg-white px-4 py-3 text-base text-[#4A4038] placeholder:text-[#786D62] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9A4F32]"
          />
          {invalid && (
            <p id="topic-error" role="alert" className="mt-2 text-sm text-[#93462E]">
              {t.topicRequired}
            </p>
          )}
          <p className="mt-5 mb-2 text-xs font-semibold text-[#665B52]">{t.topicTry}</p>
          <div className="flex flex-wrap gap-2">
            {t.topicExamples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setTopic(example);
                  setInvalid(false);
                }}
                className="rounded-full border border-[#E0D5C8] px-3 py-2 text-sm text-[#4A4038] hover:bg-[#F6F1E9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9A4F32]"
              >
                {example}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={!connected || !!error}
            className="mt-8 w-full rounded-xl bg-[#9A4F32] px-4 py-3.5 text-base font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#9A4F32] disabled:cursor-wait disabled:opacity-50"
          >
            {t.topicExplain}
          </button>
        </form>
        {error && (
          <div role="alert" className="mt-4 text-sm text-[#93462E]">
            {error}{' '}
            <button onClick={onRetry} className="font-semibold underline">
              {t.retry}
            </button>
          </div>
        )}
        <button
          onClick={onCancel}
          className="mt-5 py-2 text-sm text-[#665B52] underline underline-offset-4"
        >
          {t.topicCancel}
        </button>
        <p className="mt-4 text-xs leading-relaxed text-[#665B52]">{t.topicMicNote}</p>
      </section>
    </div>
  );
}
