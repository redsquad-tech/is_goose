import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../utils/conversionUtils';
import { AppEvents } from '../constants/events';

export interface DroppedFile {
  id: string;
  path: string;
  name: string;
  type: string;
  isImage: boolean;
  dataUrl?: string;
  isLoading?: boolean;
  error?: string;
}

export const useFileDrop = () => {
  const [droppedFiles, setDroppedFiles] = useState<DroppedFile[]>([]);

  const processFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files || []);
    if (list.length === 0) return;

    const droppedFileObjects: DroppedFile[] = [];

    for (let i = 0; i < list.length; i++) {
      const file = list[i];

      let droppedFile: DroppedFile;

      try {
        const path = window.electron.getPathForFile(file);
        const isImage = file.type.startsWith('image/');

        droppedFile = isImage
          ? {
              id: `dropped-${Date.now()}-${i}`,
              path,
              name: file.name,
              type: file.type,
              isImage: false,
              isLoading: false,
              error: 'Загрузка изображений временно отключена',
            }
          : {
              id: `dropped-${Date.now()}-${i}`,
              path,
              name: file.name,
              type: file.type,
              isImage: false,
              isLoading: false,
            };
      } catch (error) {
        console.error('Error processing file:', file.name, error);
        droppedFile = {
          id: `dropped-error-${Date.now()}-${i}`,
          path: '',
          name: file.name,
          type: file.type,
          isImage: false,
          isLoading: false,
          error: `Failed to get file path: ${errorMessage(error, 'Unknown error')}`,
        };
      }

      droppedFileObjects.push(droppedFile);
    }

    setDroppedFiles((prev) => [...prev, ...droppedFileObjects]);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    processFiles(files);
  }, [processFiles]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  useEffect(() => {
    const onGlobalFileDrop = (event: Event) => {
      const customEvent = event as CustomEvent<{ files?: File[] }>;
      const files = customEvent.detail?.files || [];
      processFiles(files);
    };

    window.addEventListener(AppEvents.GLOBAL_FILE_DROP, onGlobalFileDrop as EventListener);
    return () =>
      window.removeEventListener(AppEvents.GLOBAL_FILE_DROP, onGlobalFileDrop as EventListener);
  }, [processFiles]);

  return {
    droppedFiles,
    setDroppedFiles,
    handleDrop,
    handleDragOver,
  };
};
