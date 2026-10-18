import { useCallback, useEffect, useState } from 'react';
import { shopApi } from '../api';
import { FAQ_QUESTIONS } from '../data/faq';
export function Faq() {
  const [answers, setAnswers] = useState<Record<string, string> | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await shopApi.getFaqAnswers();
      setAnswers(Object.fromEntries(res.answers.map((a) => [a.id, a.answer])));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const toggle = (id: string) => {
    setOpen((current) => (current === id ? null : id));
    if (!answers) void load();
  };
  return (
    <section>
      <h1>Frequently asked questions</h1>
      <div className="faq" data-component="FaqAccordion">
        {FAQ_QUESTIONS.map((q) => {
          const expanded = open === q.id;
          return (
            <div key={q.id} className="faq-item">
              <h2 className="faq-question">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`faq-answer-${q.id}`}
                  onClick={() => toggle(q.id)}
                >
                  {q.question}
                </button>
              </h2>
              <div id={`faq-answer-${q.id}`} className="faq-answer" hidden={!expanded}>
                <p>
                  {answers?.[q.id] ??
                    (failed
                      ? 'This answer could not be loaded. Open the question again.'
                      : 'Loading…')}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
