import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { Button, TooltipAnchor } from '@librechat/client';
import { useCopilotStatus } from './api';
import { useLocalize } from '~/hooks';

export default function CopilotNav({
  layout = 'icon',
  onNavigate,
}: {
  layout?: 'icon' | 'row';
  onNavigate?: () => void;
}) {
  const localize = useLocalize();
  const { data } = useCopilotStatus();
  if (!data?.enabled) return null;
  const row = layout === 'row';
  const button = (
    <Button
      asChild
      variant="nav"
      size={row ? 'row' : 'icon'}
      className={row ? 'w-full justify-start' : 'h-9 w-9'}
    >
      <Link
        to="/copilot"
        aria-label={localize('com_copilot_title')}
        onClick={(event) => {
          if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0)
            onNavigate?.();
        }}
      >
        <Sparkles className="h-5 w-5 shrink-0" aria-hidden="true" />
        {row && <span>{localize('com_copilot_title')}</span>}
      </Link>
    </Button>
  );
  return row ? (
    button
  ) : (
    <TooltipAnchor side="right" description={localize('com_copilot_title')} render={button} />
  );
}
