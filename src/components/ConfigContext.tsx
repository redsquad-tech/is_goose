import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import {
  readAllConfig,
  readConfig,
  removeConfig,
  upsertConfig,
  providers,
} from '../api';
import type {
  ConfigResponse,
  UpsertConfigQuery,
  ConfigKeyQuery,
  ProviderDetails,
} from '../api';

interface ConfigContextType {
  config: ConfigResponse['config'];
  providersList: ProviderDetails[];
  upsert: (key: string, value: unknown, is_secret: boolean) => Promise<void>;
  read: (key: string, is_secret: boolean) => Promise<unknown>;
  remove: (key: string, is_secret: boolean) => Promise<void>;
  getProviders: (b: boolean) => Promise<ProviderDetails[]>;
}

interface ConfigProviderProps {
  children: React.ReactNode;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export const ConfigProvider: React.FC<ConfigProviderProps> = ({ children }) => {
  const [config, setConfig] = useState<ConfigResponse['config']>({});
  const [providersList, setProvidersList] = useState<ProviderDetails[]>([]);

  // Ref to access providersList in getProviders without recreating the callback
  const providersListRef = React.useRef<ProviderDetails[]>(providersList);
  providersListRef.current = providersList;

  const reloadConfig = useCallback(async () => {
    const response = await readAllConfig();
    setConfig(response.data?.config || {});
  }, []);

  const upsert = useCallback(
    async (key: string, value: unknown, isSecret: boolean = false) => {
      const query: UpsertConfigQuery = {
        key: key,
        value: value,
        is_secret: isSecret,
      };
      await upsertConfig({
        body: query,
      });
      await reloadConfig();
    },
    [reloadConfig]
  );

  const read = useCallback(async (key: string, is_secret: boolean = false) => {
    const query: ConfigKeyQuery = { key: key, is_secret: is_secret };
    const response = await readConfig({
      body: query,
    });
    return response.data;
  }, []);

  const remove = useCallback(
    async (key: string, is_secret: boolean) => {
      const query: ConfigKeyQuery = { key: key, is_secret: is_secret };
      await removeConfig({
        body: query,
      });
      await reloadConfig();
    },
    [reloadConfig]
  );

  const getProviders = useCallback(async (forceRefresh = false): Promise<ProviderDetails[]> => {
    if (forceRefresh || providersListRef.current.length === 0) {
      try {
        const response = await providers();
        const providersData = response.data || [];
        setProvidersList(providersData);
        return providersData;
      } catch (error) {
        console.error('Failed to fetch providers:', error);
        return providersListRef.current;
      }
    }
    return providersListRef.current;
  }, []);

  useEffect(() => {
    // Load all configuration data and providers on mount
    (async () => {
      // Load config
      const configResponse = await readAllConfig();
      setConfig(configResponse.data?.config || {});

      // Load providers
      try {
        const providersResponse = await providers();
        const providersData = providersResponse.data || [];
        setProvidersList(providersData);
      } catch (error) {
        console.error('Failed to load providers:', error);
        setProvidersList([]);
      }
    })();
  }, []);

  const contextValue = useMemo(() => {
    return {
      config,
      providersList,
      upsert,
      read,
      remove,
      getProviders,
    };
  }, [config, providersList, upsert, read, remove, getProviders]);

  return <ConfigContext.Provider value={contextValue}>{children}</ConfigContext.Provider>;
};

export const useConfig = () => {
  const context = useContext(ConfigContext);
  if (context === undefined) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
};
