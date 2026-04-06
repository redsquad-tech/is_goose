import React from 'react';
import { FolderTree, MessageSquare, Code } from 'lucide-react';

interface PopularChatTopicsProps {
  append: (text: string) => void;
}

interface ChatTopic {
  id: string;
  icon: React.ReactNode;
  description: string;
  prompt: string;
}

const POPULAR_TOPICS: ChatTopic[] = [
  {
    id: 'organize-photos',
    icon: <FolderTree className="w-5 h-5" />,
    description: 'Разложи фотографии на моём рабочем столе по аккуратным папкам по темам',
    prompt: 'Разложи фотографии на моём рабочем столе по аккуратным папкам по темам',
  },
  {
    id: 'government-forms',
    icon: <MessageSquare className="w-5 h-5" />,
    description:
      'Подробно опиши разные формы правления и ранжируй их по условной шкале',
    prompt:
      'Подробно опиши разные формы правления и ранжируй их по условной шкале',
  },
  {
    id: 'tamagotchi-game',
    icon: <Code className="w-5 h-5" />,
    description:
      'Разработай игру-тамагочи для моего компьютера в пиксельной стилистике',
    prompt: 'Разработай игру-тамагочи для моего компьютера в пиксельной стилистике',
  },
];

export default function PopularChatTopics({ append }: PopularChatTopicsProps) {
  const handleTopicClick = (prompt: string) => {
    append(prompt);
  };

  return (
    <div className="absolute bottom-0 left-0 p-6 max-w-md">
      <h3 className="text-text-secondary text-sm mb-1">Популярные темы для чата</h3>
      <div className="space-y-1">
        {POPULAR_TOPICS.map((topic) => (
          <div
            key={topic.id}
            className="flex items-center justify-between py-1.5 hover:bg-background-secondary rounded-md cursor-pointer transition-colors"
            onClick={() => handleTopicClick(topic.prompt)}
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="flex-shrink-0 text-text-secondary">{topic.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-text-primary text-sm leading-tight">{topic.description}</p>
              </div>
            </div>
            <div className="flex-shrink-0 ml-4">
              <button
                className="text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTopicClick(topic.prompt);
                }}
              >
                Начать
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
