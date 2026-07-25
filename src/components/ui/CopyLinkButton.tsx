'use client';

import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface CopyLinkButtonProps {
  /** Path relative to the site origin, e.g. `/share/abc`. */
  path: string;
  label: string;
}

/** Copy-to-clipboard needs a client boundary — an onClick on a server
 *  component silently never fires. */
export default function CopyLinkButton({ path, label }: CopyLinkButtonProps) {
  const { toast } = useToast();
  const { t } = useTranslation();

  return (
    <Button
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(`${window.location.origin}${path}`);
          toast(t('common.copied'), 'success');
        } catch {
          toast(t('common.copyFailed'), 'error');
        }
      }}
    >
      {label}
    </Button>
  );
}
