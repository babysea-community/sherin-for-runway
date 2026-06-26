import { Fragment, type ReactNode } from 'react';

import { DEFAULT_GENERATION_OUTPUT_NUMBER } from '@/lib/app-config';
import { Input } from '@/components/ui/input';

import {
  Field,
  InputImageUrlsField,
  InputVideoUrlsField,
  NumberField,
  OutputFormatField,
  PromptField,
  RatioField,
  Select,
  getFieldDescription,
} from './form-controls';

type ByokFormFieldsProps = {
  defaultDuration?: number;
  defaultOutputFormat: string;
  defaultRatio: string;
  duration?: {
    defaultValue: number;
    max: number;
    min: number;
    required: boolean;
  };
  inputFileLimit: number;
  onPromptChange: (prompt: string) => void;
  outputFormatOptions: string[];
  prompt: string;
  promptRequired: boolean;
  ratioOptions: string[];
  requiresImageInput: boolean;
  requiresVideoInput: boolean;
  showDuration: boolean;
  showModeration: boolean;
  showSeed: boolean;
  videoInputFileLimit: number;
};

export function ByokFormFields({
  defaultDuration,
  defaultOutputFormat,
  defaultRatio,
  duration,
  inputFileLimit,
  onPromptChange,
  outputFormatOptions,
  prompt,
  promptRequired,
  ratioOptions,
  requiresImageInput,
  requiresVideoInput,
  showDuration,
  showModeration,
  showSeed,
  videoInputFileLimit,
}: ByokFormFieldsProps) {
  const remainingFields: ExtraField[] = [];

  if (showModeration) {
    remainingFields.push({
      key: 'generation_moderation',
      label: 'Moderation',
      node: (
        <Field
          label="Moderation"
          description={getFieldDescription('generation_moderation')}
        >
          <Select
            name="generation_moderation"
            defaultValue="false"
            options={[
              { value: 'false', label: 'Low' },
              { value: 'true', label: 'Auto' },
            ]}
          />
        </Field>
      ),
    });
  }

  if (showSeed) {
    remainingFields.push({
      key: 'byok_seed',
      label: 'Seed',
      node: (
        <NumberField
          description={getFieldDescription('generation_seed')}
          label="Seed"
          name="byok_seed"
          min={0}
          max={4_294_967_295}
        />
      ),
    });
  }

  remainingFields.sort((left, right) => left.label.localeCompare(right.label));

  return (
    <div className="space-y-5">
      <PromptField
        prompt={prompt}
        required={promptRequired}
        onPromptChange={onPromptChange}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <RatioField
          defaultRatio={defaultRatio}
          label="Aspect ratio"
          ratioOptions={ratioOptions}
        />

        <OutputFormatField
          defaultOutputFormat={defaultOutputFormat}
          outputFormatOptions={outputFormatOptions}
        />

        <Field
          label="Number of outputs"
          description={getFieldDescription('generation_output_number')}
        >
          <Input
            readOnly
            name="generation_output_number"
            type="number"
            value={DEFAULT_GENERATION_OUTPUT_NUMBER}
            className="cursor-not-allowed text-slate-300"
          />
        </Field>

        {showDuration && duration ? (
          <NumberField
            defaultValue={defaultDuration}
            description={getFieldDescription('generation_duration')}
            label="Duration"
            name="generation_duration"
            min={duration.min}
            max={duration.max}
          />
        ) : null}

        {inputFileLimit > 0 ? (
          <InputImageUrlsField
            descriptionKey="generation_input_image_file"
            maxUrls={inputFileLimit}
            name="generation_input_file"
            required={requiresImageInput}
          />
        ) : null}

        {videoInputFileLimit > 0 ? (
          <InputVideoUrlsField
            descriptionKey="generation_input_video_file"
            maxUrls={videoInputFileLimit}
            name="generation_input_video_file"
            required={requiresVideoInput}
          />
        ) : null}

        {remainingFields.map((field) => (
          <Fragment key={field.key}>{field.node}</Fragment>
        ))}
      </div>
    </div>
  );
}

type ExtraField = {
  key: string;
  label: string;
  node: ReactNode;
};
