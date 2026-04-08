import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { useConfig } from './ConfigContext';
import { setConfigProvider } from '../api';

const INSIGHTSTREAM_PROVIDER = 'openai';
const INSIGHTSTREAM_MODEL = 'compressa1';
const INSIGHTSTREAM_HOST = 'https://provider.redsquad.tech';
const INSIGHTSTREAM_BASE_PATH = 'v1/responses';

interface InsightStreamOnboardingProps {
  onConfigured: () => void;
}

export default function InsightStreamOnboarding({
  onConfigured,
}: InsightStreamOnboardingProps) {
  const navigate = useNavigate();
  const { upsert } = useConfig();
  const [apiKey, setApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSubmitDisabled = useMemo(() => isSaving || apiKey.trim().length === 0, [apiKey, isSaving]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setError('Введите ключ доступа.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await upsert('GOOSE_PROVIDER', INSIGHTSTREAM_PROVIDER, false);
      await upsert('GOOSE_MODEL', INSIGHTSTREAM_MODEL, false);
      await upsert('OPENAI_HOST', INSIGHTSTREAM_HOST, false);
      await upsert('OPENAI_BASE_PATH', INSIGHTSTREAM_BASE_PATH, false);
      await upsert('OPENAI_API_KEY', trimmedKey, true);
      await setConfigProvider({
        body: {
          provider: INSIGHTSTREAM_PROVIDER,
          model: INSIGHTSTREAM_MODEL,
        },
        throwOnError: true,
      });

      onConfigured();
      navigate('/', { replace: true });
    } catch (submitError) {
      console.error('Failed to save InsightStream configuration:', submitError);
      setError('Не удалось сохранить настройки. Попробуйте ещё раз.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="h-screen w-full bg-background-secondary text-text-primary flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-border-primary bg-background-primary p-8 shadow-sm">
        <div className="space-y-3">
          <h1 className="text-3xl font-light">Подключение</h1>
          <p className="text-sm text-text-secondary leading-6">Введите ваш ключ доступа.</p>
        </div>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label htmlFor="insightstream-api-key" className="text-sm text-text-secondary">
              API key
            </label>
            <Input
              id="insightstream-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Введите ключ"
              autoFocus
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <Button type="submit" className="w-full" disabled={isSubmitDisabled}>
            {isSaving ? 'Сохраняем...' : 'Продолжить'}
          </Button>
        </form>
      </div>
    </div>
  );
}
