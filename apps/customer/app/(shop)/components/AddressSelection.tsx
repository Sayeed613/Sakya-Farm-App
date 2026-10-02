import { useCallback, useMemo, useRef } from 'react';
import type { CheckoutAddress } from '../../../src/api/checkout';
import { AddressPickerSheet } from '../../../src/components/checkout/AddressPickerSheet';
import { AddressSheet } from '../../../src/components/checkout/AddressSheet';
import { useAuthStore } from '../../../src/stores/auth-store';
import { useLastAddressStore } from '../../../src/stores/last-address-store';

interface AddressSelectionProps {
  address: CheckoutAddress | null;
  /** Controlled visibility of the saved-address picker sheet. */
  pickerOpen: boolean;
  /** Controlled visibility of the manual-entry sheet. */
  sheetOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  onSheetOpenChange: (open: boolean) => void;
  onAddressChange: (address: CheckoutAddress | null) => void;
  onAddressConfirm: (address: CheckoutAddress) => void;
  onSaveToAddressBook: (address: CheckoutAddress) => Promise<void>;
  onAddressBookSaveStatus: (message: string | null) => void;
}

/**
 * The checkout's two address sheets — the saved-address picker and the
 * manual-entry form — with their open state controlled by the parent (the
 * delivery card opens the picker, the place-order bar opens the form).
 */
export default function AddressSelection({
  address,
  pickerOpen,
  sheetOpen,
  onPickerOpenChange,
  onSheetOpenChange,
  onAddressChange,
  onAddressConfirm,
  onSaveToAddressBook,
  onAddressBookSaveStatus,
}: AddressSelectionProps) {
  const session = useAuthStore((state) => state.session);
  const rememberAddress = useLastAddressStore((state) => state.remember);

  /**
   * Prefill for the manual-entry sheet. Set when editing a saved row from
   * the picker, cleared when opening a fresh entry or closing the sheet.
   */
  const editPrefillRef = useRef<CheckoutAddress | null>(null);
  const sheetInitial = editPrefillRef.current;

  const contactDefaults = useMemo(() => {
    // session.user is guarded: a malformed persisted session (partial JSON,
    // older shape) must not crash the whole checkout — prefill just degrades.
    if (session === null || session.user === undefined || session.user === null) return null;
    return {
      name: [session.user.firstName, session.user.lastName].filter(Boolean).join(' ').trim(),
      phone: session.user.phone ?? '',
    };
  }, [session]);

  const handleSaveToBook = useCallback(
    async (saved: CheckoutAddress) => {
      try {
        await onSaveToAddressBook(saved);
        onAddressBookSaveStatus(null);
      } catch {
        onAddressBookSaveStatus(
          'This address is set for your order, but could not be saved to your address book. Try again later.',
        );
      }
    },
    [onSaveToAddressBook, onAddressBookSaveStatus],
  );

  return (
    <>
      {/* Address book picker (signed-in): saved addresses from the server. */}
      <AddressPickerSheet
        visible={pickerOpen}
        selected={address}
        onClose={() => onPickerOpenChange(false)}
        onConfirm={(picked) => {
          rememberAddress(picked);
          onPickerOpenChange(false);
          onAddressConfirm(picked);
        }}
        onEdit={(prefill) => {
          // Editing a saved row: prefill the manual sheet with THAT row.
          editPrefillRef.current = prefill;
          onPickerOpenChange(false);
          onSheetOpenChange(true);
        }}
        onAddNew={() => {
          // Fresh entry: clear any edit prefill so the sheet opens EMPTY
          // (session name/phone still apply via contactDefaults).
          editPrefillRef.current = null;
          onPickerOpenChange(false);
          onSheetOpenChange(true);
        }}
      />

      {/* Manual entry / edit. `sheetInitial` wins over the last-used
          default so editing a saved row opens THAT row's data. */}
      <AddressSheet
        visible={sheetOpen}
        initial={sheetInitial}
        contactDefaults={contactDefaults}
        canSaveToBook={editPrefillRef.current === null}
        onSave={async (saved, saveToBook) => {
          // A manual save is an explicit customer choice too.
          rememberAddress(saved);
          onAddressChange(saved);
          if (saveToBook) {
            await handleSaveToBook(saved);
          }
          onSheetOpenChange(false);
        }}
        onClose={() => {
          onSheetOpenChange(false);
          editPrefillRef.current = null;
        }}
      />
    </>
  );
}
