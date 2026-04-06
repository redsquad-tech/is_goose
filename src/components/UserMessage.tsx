import { useRef } from 'react';
import ImagePreview from './ImagePreview';
import MarkdownContent from './MarkdownContent';
import { getTextAndImageContent } from '../types/message';
import { Message } from '../api';
import MessageCopyLink from './MessageCopyLink';
import { formatMessageTimestamp } from '../utils/timeUtils';

interface UserMessageProps {
  message: Message;
}

export default function UserMessage({ message }: UserMessageProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const { textContent, imagePaths } = getTextAndImageContent(message);
  const timestamp = formatMessageTimestamp(message.created);

  return (
    <div className="w-full mt-[16px] opacity-0 animate-[appear_150ms_ease-in_forwards]">
      <div className="message flex justify-end w-full">
        <div className="flex-col max-w-[85%] w-fit">
          <div className="flex flex-col group">
            {textContent.trim() && (
              <div className="flex bg-text-primary text-background-primary rounded-xl py-2.5 px-4">
                <div ref={contentRef}>
                  <MarkdownContent
                    content={textContent}
                    className="!text-inherit prose-a:!text-inherit prose-headings:!text-inherit prose-strong:!text-inherit prose-em:!text-inherit prose-li:!text-inherit prose-p:!text-inherit user-message"
                  />
                </div>
              </div>
            )}

            {imagePaths.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {imagePaths.map((imagePath, index) => (
                  <ImagePreview key={index} src={imagePath} />
                ))}
              </div>
            )}

            <div className="relative h-[22px] flex justify-end text-right">
              <div className="absolute w-40 font-mono right-0 text-xs text-text-secondary pt-1 transition-all duration-200 group-hover:-translate-y-4 group-hover:opacity-0">
                {timestamp}
              </div>
              <div className="absolute right-0 pt-1 flex items-center gap-2">
                <MessageCopyLink text={textContent} contentRef={contentRef} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
