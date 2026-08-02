import { UserButton } from '@clerk/astro/react';

interface UserControlProps {
  showName?: boolean;
}

/** Renders Clerk's user menu with RTL-aware avatar and identifier placement. */
export default function UserControl({ showName = false }: UserControlProps) {
  return (
    <UserButton
      showName={showName}
      appearance={{
        elements: {
          // Clerk renders [identifier, avatar]; under dir="rtl" that puts the
          // name on the right. Reverse so the avatar hugs the sidebar edge.
          userButtonBox: { flexDirection: 'row-reverse' },
          userButtonTrigger: { height: 'auto', alignItems: 'center' },
          userButtonAvatarBox: { width: '36px', height: '36px' },
          userButtonOuterIdentifier: {
            maxWidth: '150px',
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
            lineHeight: 1.25,
            textAlign: 'start',
          },
        },
      }}
    />
  );
}
