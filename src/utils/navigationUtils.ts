import { NavigateFunction } from 'react-router-dom';
import { UserInput } from '../types/message';

export type View =
  | 'chat'
  | 'pair'
  | 'sessions'
  | 'loading';

export type ViewOptions = {
  disableAnimation?: boolean;
  initialMessage?: UserInput;
  resumeSessionId?: string;
};

export const createNavigationHandler = (navigate: NavigateFunction) => {
  return (view: View, options?: ViewOptions) => {
    switch (view) {
      case 'chat':
        navigate('/', { state: options });
        break;
      case 'pair': {
        // Put resumeSessionId in URL search params (not just state) so that:
        // 1. The sidebar can read it to highlight the active session
        // 2. Page refresh preserves which session is active
        // 3. Browser back/forward navigation works correctly
        const searchParams = new URLSearchParams();
        if (options?.resumeSessionId) {
          searchParams.set('resumeSessionId', options.resumeSessionId);
        }
        const url = searchParams.toString() ? `/pair?${searchParams.toString()}` : '/pair';
        navigate(url, { state: options });
        break;
      }
      case 'sessions':
        navigate('/sessions', { state: options });
        break;
      default:
        navigate('/', { state: options });
    }
  };
};
