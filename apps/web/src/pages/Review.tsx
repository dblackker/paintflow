import { useState } from 'react';
import { useParams } from 'react-router-dom';

import { Button } from '@/components/Button';
import { Card, CardContent } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { API_URL } from '@/lib/api';

type Step = 'rating' | 'feedback' | 'public-review' | 'done';

interface ReviewResponse {
  success?: boolean;
  redirect?: boolean;
  reviewUrl?: string | null;
  error?: string;
}

export function Review() {
  const { id } = useParams<{ id: string }>();
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [step, setStep] = useState<Step>('rating');
  const [publicReviewUrl, setPublicReviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submitReview(nextRating = rating, nextFeedback = feedback) {
    if (!id || !nextRating) return;
    setError('');
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_URL}/v1/reviews/${id}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: nextRating,
          feedback: nextFeedback.trim() || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({})) as ReviewResponse;
      if (!response.ok) throw new Error(payload.error || 'Failed to submit review');

      if (payload.redirect) {
        setPublicReviewUrl(payload.reviewUrl || null);
        setStep('public-review');
      } else {
        setStep('done');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit review');
    } finally {
      setIsSubmitting(false);
    }
  }

  function chooseRating(value: number) {
    setRating(value);
    setError('');
    if (value >= 4) {
      void submitReview(value, '');
      return;
    }
    setStep('feedback');
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-lg items-center justify-center px-1 py-6 sm:px-0">
      <Card className="w-full">
        <CardContent className="p-6 text-center sm:p-8">
          {step === 'rating' && (
            <>
              <p className="pf-kicker">Quick feedback</p>
              <h1 className="pf-page-title mt-2">How did we do?</h1>
              <p className="pf-page-copy mx-auto mt-2 max-w-sm">Tap a star to rate your painting project experience.</p>

              <div className="mt-7 flex justify-center gap-1.5" aria-label="Rate your experience">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`rounded-full p-1 text-4xl transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      rating && value > rating ? 'text-gray-300' : 'text-yellow-500'
                    }`}
                    onClick={() => chooseRating(value)}
                    disabled={isSubmitting}
                    aria-label={`${value} star${value === 1 ? '' : 's'}`}
                  >
                    {'\u2605'}
                  </button>
                ))}
              </div>
              <p className="pf-meta mt-5">Your feedback goes directly to the painting company.</p>
            </>
          )}

          {step === 'feedback' && (
            <form
              className="text-left"
              onSubmit={(event) => {
                event.preventDefault();
                void submitReview();
              }}
            >
              <div className="text-center">
                <p className="pf-kicker">Private feedback</p>
                <h1 className="pf-page-title mt-2">Help us make it right</h1>
                <p className="pf-page-copy mt-2">Tell the team what could have gone better.</p>
              </div>
              <label className="mt-6 block">
                <span className="text-sm font-medium text-gray-800">Feedback</span>
                <textarea
                  className="input mt-1 min-h-36 resize-y"
                  maxLength={5000}
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  placeholder="What should the team know?"
                />
              </label>
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="secondary" onClick={() => setStep('rating')} disabled={isSubmitting}>
                  Back
                </Button>
                <Button type="submit" isLoading={isSubmitting}>
                  Submit feedback
                </Button>
              </div>
            </form>
          )}

          {step === 'public-review' && (
            <>
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-700">
                <Icon name="check" className="h-5 w-5" />
              </span>
              <h1 className="pf-page-title mt-4">Thank you</h1>
              <p className="pf-page-copy mt-2">
                We are glad the project went well. Sharing your experience publicly helps other homeowners find the team.
              </p>
              {publicReviewUrl ? (
                <Button as="a" href={publicReviewUrl} target="_blank" rel="noreferrer" className="mt-6 w-full" size="lg">
                  Leave public review
                </Button>
              ) : (
                <p className="mt-6 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-900">
                  Your rating was received. The public review link has not been configured yet.
                </p>
              )}
            </>
          )}

          {step === 'done' && (
            <>
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                <Icon name="message" className="h-5 w-5" />
              </span>
              <h1 className="pf-page-title mt-4">Thank you for your feedback</h1>
              <p className="pf-page-copy mt-2">The team received your note and can follow up from their CRM.</p>
            </>
          )}

          {error && (
            <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-sm text-red-700" role="alert">
              {error}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
