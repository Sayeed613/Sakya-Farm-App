import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text as RNText, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AuthUser } from '@sakya/types';

import { requireApiClient } from '../../src/api/client';
import { AuthGate } from '../../src/components/AuthGate';
import { SubScreenHeader } from '../../src/components/navigation/SubScreenHeader';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { colors } from '../../src/theme';
import { useAuthStore } from '../../src/stores/auth-store';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E4DED2';

/**
 * The avatar URL the API issues is a relative path (`/users/me/avatar?v=…`).
 * Prefix it with the API base URL so expo-image can fetch it; a full URL
 * passes through untouched.
 */
function resolveAvatarUri(avatarUrl: string): string {
  if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) return avatarUrl;
  const base = process.env.EXPO_PUBLIC_API_URL ?? '';
  return `${base.replace(/\/$/, '')}${avatarUrl}`;
}

/**
 * Edit profile — `PATCH /users/me` with the session user's current values.
 *
 * On success the session user is updated in the auth store (persisted), so
 * the Account screen and any other identity surfaces reflect the change
 * immediately without a re-login.
 */
export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const session = useAuthStore((state) => state.session);
  const restoring = useAuthStore((state) => state.restoring);
  const updateSession = useAuthStore((state) => state.updateSession);
  const queryClient = useQueryClient();

  const [firstName, setFirstName] = useState(session?.user.firstName ?? '');
  const [lastName, setLastName] = useState(session?.user.lastName ?? '');
  const [email, setEmail] = useState(session?.user.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  /**
   * Profile photo: pick → resize on-device → PUT to the API → the returned
   * URL (with a fresh cache-busting version) goes into the session so every
   * screen that shows the avatar updates at once.
   */
  const pickAndUploadAvatar = async (): Promise<void> => {
    if (uploading) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access needed', 'Allow photo access so you can choose a profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      exif: false,
    });
    if (result.canceled || result.assets.length === 0) return;

    const asset = result.assets[0]!;
    setUploading(true);
    try {
      const api = requireApiClient();
      const form = new FormData();
      form.append('file', {
        // React Native's FormData accepts this RN-specific asset shape.
        uri: asset.uri,
        name: 'avatar.jpg',
        type: asset.mimeType ?? 'image/jpeg',
      } as unknown as Blob);
      const response = await api.http.request<{ avatarUrl: string }>('/users/me/avatar', {
        method: 'PUT',
        body: form,
      });
      if (session !== null) {
        updateSession({ ...session, user: { ...session.user, avatarUrl: response.avatarUrl } });
      }
    } catch (err) {
      Alert.alert(
        'Could not update photo',
        err instanceof Error ? err.message : 'Please try a different photo.',
      );
    } finally {
      setUploading(false);
    }
  };

  const save = useMutation({
    mutationFn: async (): Promise<AuthUser> => {
      const api = requireApiClient();
      return api.http.request<AuthUser>('/users/me', {
        method: 'PATCH',
        body: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim() === '' ? null : email.trim(),
        },
      });
    },
    onSuccess: (updatedUser) => {
      if (session !== null) {
        updateSession({ ...session, user: updatedUser });
      }
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      router.back();
    },
    onError: (err: Error) => {
      setError(err.message || 'Could not save your profile. Try again.');
    },
  });

  if (restoring) {
    return <Screen><Text color={colors.textMuted}>Loading…</Text></Screen>;
  }

  if (session === null) {
    return (
      <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
        <AuthGate
          icon="person-outline"
          title="Verify your number to edit your profile"
          message="Your profile is personal. Verify your phone to continue."
          redirectTo="/(shop)/edit-profile"
        />
      </View>
    );
  }

  const canSave =
    firstName.trim().length > 0 &&
    (email.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) &&
    !save.isPending;

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <SubScreenHeader title="Edit profile" />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} className="gap-4">
        {/* PROFILE PHOTO — tap the circle to pick a new one. Shows the photo
            when set, else the same person glyph the Account screen shows. */}
        <View className="items-center gap-2">
          <Pressable
            onPress={() => void pickAndUploadAvatar()}
            disabled={uploading}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            className="h-[96px] w-[96px] items-center justify-center overflow-hidden rounded-full border-2 active:opacity-75"
            style={{ borderColor: LINE, backgroundColor: '#FFFFFF' }}
          >
            {session?.user.avatarUrl !== null && session?.user.avatarUrl !== undefined ? (
              <Image
                source={{ uri: resolveAvatarUri(session.user.avatarUrl) }}
                style={{ width: 92, height: 92 }}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <Ionicons name="person" size={44} color={BRAND} />
            )}
            <View
              className="absolute bottom-0 right-0 h-[30px] w-[30px] items-center justify-center rounded-full"
              style={{ backgroundColor: BRAND }}
            >
              <Ionicons name={uploading ? 'hourglass-outline' : 'camera'} size={15} color="#FFFFFF" />
            </View>
          </Pressable>
          <RNText className="text-[11.5px]" style={{ color: MUTED }}>
            {uploading ? 'Uploading…' : 'Tap to change photo'}
          </RNText>
        </View>

        <View className="gap-1.5">
          <RNText className="text-[12px] font-bold" style={{ color: MUTED }}>
            FIRST NAME
          </RNText>
          <TextInput
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Your first name"
            placeholderTextColor={MUTED}
            className="rounded-xl border bg-white px-3.5 py-3 text-[14px]"
            style={{ borderColor: LINE, color: INK }}
            editable={!save.isPending}
          />
        </View>

        <View className="gap-1.5">
          <RNText className="text-[12px] font-bold" style={{ color: MUTED }}>
            LAST NAME
          </RNText>
          <TextInput
            value={lastName}
            onChangeText={setLastName}
            placeholder="Your last name"
            placeholderTextColor={MUTED}
            className="rounded-xl border bg-white px-3.5 py-3 text-[14px]"
            style={{ borderColor: LINE, color: INK }}
            editable={!save.isPending}
          />
        </View>

        <View className="gap-1.5">
          <RNText className="text-[12px] font-bold" style={{ color: MUTED }}>
            EMAIL (OPTIONAL)
          </RNText>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={MUTED}
            keyboardType="email-address"
            autoCapitalize="none"
            className="rounded-xl border bg-white px-3.5 py-3 text-[14px]"
            style={{ borderColor: LINE, color: INK }}
            editable={!save.isPending}
          />
        </View>

        <View className="rounded-xl border p-3" style={{ borderColor: LINE }}>
          <RNText className="text-[12px]" style={{ color: MUTED }}>
            Phone: {session.user.phone ?? '—'} (your sign-in identity, cannot be changed here)
          </RNText>
        </View>

        {error !== null ? (
          <RNText className="text-[12.5px] font-semibold" style={{ color: '#B3453E' }}>
            {error}
          </RNText>
        ) : null}

        <Pressable
          onPress={() => {
            setError(null);
            save.mutate();
          }}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="Save profile"
          className="h-12 items-center justify-center rounded-full"
          style={{ backgroundColor: BRAND, opacity: canSave ? 1 : 0.5 }}
        >
          <RNText className="text-[14px] font-bold text-white">
            {save.isPending ? 'Saving…' : 'Save changes'}
          </RNText>
        </Pressable>
      </ScrollView>
    </View>
  );
}
