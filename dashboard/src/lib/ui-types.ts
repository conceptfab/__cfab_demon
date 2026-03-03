export interface PromptConfig {
  title: string;
  initialValue: string;
  onConfirm: (val: string) => void;
  onCancel?: () => void;
  description?: string;
}
