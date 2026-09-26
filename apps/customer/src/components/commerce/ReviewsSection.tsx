import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Text as RNText, TextInput, View } from 'react-native';

import { journeyApi } from '../../api/journey';
import { useAuthStore } from '../../stores/auth-store';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E4DED2';

/**
 * Reviews section — shows published reviews (`GET /products/:id/reviews`)
 * and, when the server says the caller is eligible (a delivered order line
 * backs it and no review exists yet), the write form.
 *
 * Eligibility, the order-line binding and one-review-per-line enforcement all
 * live on the server; the client only renders what it is told. A submitted
 * review enters moderation (status PENDING) and the form is replaced with
 * that honest state — it does not appear in the public list until approved.
 */
export function ReviewsSection({ productId }: { productId: string }) {
  const session = useAuthStore((state) => state.session);
  const queryClient = useQueryClient();

  const reviews = useQuery({
    queryKey: ['reviews', productId],
    queryFn: () => journeyApi.listProductReviews(productId),
    staleTime: 60_000,
  });

  const eligibility = useQuery({
    queryKey: ['reviews', productId, 'eligibility'],
    queryFn: () => journeyApi.getReviewEligibility(productId),
    enabled: session !== null,
    staleTime: 60_000,
  });

  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      journeyApi.createReview({
        productId,
        rating,
        title: title.trim() || undefined,
        body: body.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reviews', productId] });
    },
    onError: (err: Error) => {
      setFormError(err.message || 'Could not submit your review. Try again.');
    },
  });

  const data = reviews.data;
  const canWrite = eligibility.data?.eligible === true;

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <RNText className="text-[15px] font-bold" style={{ color: INK }}>
          Reviews
        </RNText>
        {data && data.count > 0 && data.averageRating !== null ? (
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="star" size={14} color="#C99A2E" />
            <RNText className="text-[13px] font-bold" style={{ color: INK }}>
              {data.averageRating.toFixed(1)}
            </RNText>
            <RNText className="text-[12px]" style={{ color: MUTED }}>
              ({data.count})
            </RNText>
          </View>
        ) : null}
      </View>

      {reviews.isPending ? (
        <RNText className="text-[12.5px]" style={{ color: MUTED }}>
          Loading reviews…
        </RNText>
      ) : reviews.isError ? (
        <Pressable onPress={() => void reviews.refetch()} className="self-start">
          <RNText className="text-[12.5px] font-semibold" style={{ color: BRAND }}>
            Reviews could not be loaded. Tap to retry.
          </RNText>
        </Pressable>
      ) : data !== undefined && data.items.length > 0 ? (
        <View className="gap-2.5">
          {data.items.slice(0, 5).map((review) => (
            <View key={review.id} className="rounded-2xl border p-3.5" style={{ borderColor: LINE }}>
              <View className="flex-row items-center gap-1">
                {Array.from({ length: 5 }, (_, starIndex) => (
                  <Ionicons
                    key={starIndex}
                    name={starIndex < review.rating ? 'star' : 'star-outline'}
                    size={12}
                    color="#C99A2E"
                  />
                ))}
                <RNText className="ml-1.5 flex-1 text-[11.5px]" style={{ color: MUTED }}>
                  {review.authorFirstName} ·{' '}
                  {new Date(review.createdAt).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </RNText>
              </View>
              {review.title !== null ? (
                <RNText className="mt-1.5 text-[13px] font-semibold" style={{ color: INK }}>
                  {review.title}
                </RNText>
              ) : null}
              {review.body !== null ? (
                <RNText className="mt-0.5 text-[12.5px] leading-5" style={{ color: MUTED }}>
                  {review.body}
                </RNText>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <RNText className="text-[12.5px]" style={{ color: MUTED }}>
          No reviews yet{canWrite ? ' — be the first to write one.' : '.'}
        </RNText>
      )}

      {/* Write form — only when the server says this customer is eligible. */}
      {session !== null ? (
        eligibility.isPending ? null : eligibility.isError ? null : canWrite ? (
          submit.isSuccess ? (
            <View className="rounded-2xl border p-3.5" style={{ borderColor: '#CFE5D8', backgroundColor: '#F2F9F5' }}>
              <View className="flex-row items-center gap-2">
                <Ionicons name="checkmark-circle" size={16} color="#2E7D4F" />
                <RNText className="text-[13px] font-semibold" style={{ color: '#2E7D4F' }}>
                  Thank you — your review was submitted.
                </RNText>
              </View>
              <RNText className="mt-1 text-[12px] leading-4" style={{ color: MUTED }}>
                It will appear here once our team has checked it.
              </RNText>
            </View>
          ) : (
            <View className="rounded-2xl border p-3.5" style={{ borderColor: LINE }}>
              <RNText className="text-[13px] font-bold" style={{ color: INK }}>
                Write a review
              </RNText>
              {/* Star picker */}
              <View className="mt-2 flex-row items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Pressable
                    key={star}
                    onPress={() => setRating(star)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: rating === star }}
                    accessibilityLabel={`${star} star${star === 1 ? '' : 's'}`}
                    hitSlop={6}
                  >
                    <Ionicons
                      name={star <= rating ? 'star' : 'star-outline'}
                      size={24}
                      color="#C99A2E"
                    />
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Headline (optional)"
                placeholderTextColor={MUTED}
                maxLength={120}
                className="mt-2.5 rounded-xl border px-3 py-2.5 text-[13px]"
                style={{ borderColor: LINE, color: INK }}
                editable={!submit.isPending}
              />
              <TextInput
                value={body}
                onChangeText={setBody}
                placeholder="What did you think of the product?"
                placeholderTextColor={MUTED}
                multiline
                maxLength={2000}
                className="mt-2 rounded-xl border px-3 py-2.5 text-[13px]"
                style={{ borderColor: LINE, color: INK, minHeight: 72, textAlignVertical: 'top' }}
                editable={!submit.isPending}
              />
              {formError !== null ? (
                <RNText className="mt-1.5 text-[12px] font-semibold" style={{ color: '#B3453E' }}>
                  {formError}
                </RNText>
              ) : null}
              <Pressable
                onPress={() => {
                  if (rating === 0) {
                    setFormError('Pick a star rating first.');
                    return;
                  }
                  setFormError(null);
                  submit.mutate();
                }}
                disabled={submit.isPending}
                accessibilityRole="button"
                accessibilityLabel="Submit review"
                className="mt-3 h-11 items-center justify-center rounded-full"
                style={{ backgroundColor: BRAND, opacity: submit.isPending ? 0.6 : 1 }}
              >
                <RNText className="text-[13px] font-bold text-white">
                  {submit.isPending ? 'Submitting…' : 'Submit review'}
                </RNText>
              </Pressable>
            </View>
          )
        ) : eligibility.data !== undefined ? (
          <RNText className="text-[12px]" style={{ color: MUTED }}>
            {eligibility.data.reason}
          </RNText>
        ) : null
      ) : null}
    </View>
  );
}
