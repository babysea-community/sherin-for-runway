import { Fragment } from 'react';
import type { SemanticLadyField } from 'semantic-lady';

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
  defaultOutputFormat: string;
  defaultRatio: string;
  inputFileLimit: number;
  onPromptChange: (prompt: string) => void;
  outputFormatOptions: string[];
  prompt: string;
  ratioOptions: string[];
  schema: readonly SemanticLadyField[];
  videoInputFileLimit?: number;
};

const SHERIN_LEVEL_FIELDS = new Set([
  'generation_output_number',
  'generation_provider_order',
]);

export function ByokFormFields({
  defaultOutputFormat,
  defaultRatio,
  inputFileLimit,
  onPromptChange,
  outputFormatOptions,
  prompt,
  ratioOptions,
  schema,
  videoInputFileLimit = 0,
}: ByokFormFieldsProps) {
  const promptField = fieldByName(schema, 'generation_prompt');
  const ratioField = fieldByName(schema, 'generation_aspect_ratio');
  const outputFormatField = fieldByName(schema, 'generation_output_format');
  const inputImageField = fieldByName(schema, 'generation_input_image_file');
  const inputVideoField = fieldByName(schema, 'generation_input_video_file');
  const remainingFields = schema
    .filter((field) => !isSpecialField(field.name))
    .map((field) => ({
      key: field.name,
      label: fieldLabel(field.name),
      node: <SchemaField field={field} />,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));

  return (
    <div className="space-y-5">
      {promptField ? (
        <PromptField
          prompt={prompt}
          required={Boolean(promptField.required)}
          onPromptChange={onPromptChange}
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {ratioField ? (
          <RatioField
            defaultRatio={fieldStringDefault(ratioField) ?? defaultRatio}
            description={ratioField.description}
            label={fieldLabel(ratioField.name)}
            ratioOptions={fieldStringEnum(ratioField, ratioOptions)}
          />
        ) : null}

        {outputFormatField ? (
          <OutputFormatField
            defaultOutputFormat={
              fieldStringDefault(outputFormatField) ?? defaultOutputFormat
            }
            description={outputFormatField.description}
            outputFormatOptions={fieldStringEnum(
              outputFormatField,
              outputFormatOptions,
            )}
          />
        ) : null}

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

        {inputImageField && inputFileLimit > 0 ? (
          <InputImageUrlsField
            descriptionKey={inputImageField.name}
            maxUrls={inputFileLimit}
            name="generation_input_file"
            required={Boolean(inputImageField.required)}
          />
        ) : null}

        {inputVideoField && videoInputFileLimit > 0 ? (
          <InputVideoUrlsField
            descriptionKey={inputVideoField.name}
            maxUrls={videoInputFileLimit}
            name="generation_input_video_file"
            required={Boolean(inputVideoField.required)}
          />
        ) : null}

        {remainingFields.map((field) => (
          <Fragment key={field.key}>{field.node}</Fragment>
        ))}
      </div>
    </div>
  );
}

function SchemaField({ field }: { field: SemanticLadyField }) {
  const label = fieldLabel(field.name);
  const description = field.description ?? getFieldDescription(field.name);

  if (field.type === 'boolean') {
    return (
      <Field label={label} description={description}>
        <Select
          name={field.name}
          defaultValue={fieldBooleanDefault(field)}
          options={[
            { value: 'false', label: 'Off' },
            { value: 'true', label: 'On' },
          ]}
          placeholder="Provider default"
        />
      </Field>
    );
  }

  if (field.type === 'enum') {
    const options = fieldStringEnum(field, []);

    return (
      <Field label={label} description={description}>
        <Select
          name={field.name}
          defaultValue={fieldStringDefault(field) ?? options[0] ?? ''}
          options={options.map((value) => ({ value }))}
        />
      </Field>
    );
  }

  if (field.type === 'integer' || field.type === 'number') {
    return (
      <NumberField
        defaultValue={fieldNumberDefault(field)}
        description={description}
        label={label}
        name={field.name}
        min={field.min ?? 0}
        max={field.max ?? Number.MAX_SAFE_INTEGER}
        required={Boolean(field.required)}
        step={field.type === 'number' ? '0.1' : undefined}
      />
    );
  }

  return (
    <Field label={label} description={description}>
      <Input
        name={field.name}
        required={field.required}
        defaultValue={fieldStringDefault(field)}
        placeholder={field.placeholder ?? 'Optional'}
      />
    </Field>
  );
}

function isSpecialField(name: string) {
  return (
    SHERIN_LEVEL_FIELDS.has(name) ||
    name === 'generation_prompt' ||
    name === 'generation_aspect_ratio' ||
    name === 'generation_output_format' ||
    name === 'generation_input_image_file' ||
    name === 'generation_input_video_file'
  );
}

function fieldByName(schema: readonly SemanticLadyField[], name: string) {
  return schema.find((field) => field.name === name);
}

function fieldStringEnum(
  field: SemanticLadyField,
  fallback: readonly string[],
) {
  const values = (field.enum ?? []).filter(
    (value): value is string => typeof value === 'string',
  );

  return values.length > 0 ? values : [...fallback];
}

function fieldStringDefault(field: SemanticLadyField) {
  return typeof field.default === 'string' ? field.default : undefined;
}

function fieldNumberDefault(field: SemanticLadyField) {
  return typeof field.default === 'number' ? field.default : undefined;
}

function fieldBooleanDefault(field: SemanticLadyField) {
  return typeof field.default === 'boolean' ? String(field.default) : undefined;
}

function fieldLabel(name: string) {
  const labels: Record<string, string> = {
    generation_aspect_ratio: 'Aspect ratio',
    generation_body_control: 'Body control',
    generation_duration: 'Duration',
    generation_expression_intensity: 'Expression intensity',
    generation_guidance: 'Guidance scale',
    generation_height: 'Height',
    generation_image_prompt_strength: 'Image prompt strength',
    generation_input_image_file: 'Input image',
    generation_input_video_file: 'Input video',
    generation_moderation: 'Moderation',
    generation_output_format: 'Output format',
    generation_prompt: 'Prompt',
    generation_prompt_extend: 'Prompt extension',
    generation_raw: 'Raw mode',
    generation_reference_tag: 'Reference tag',
    generation_seed: 'Seed',
    generation_steps: 'Inference steps',
    generation_width: 'Width',
  };

  return (
    labels[name] ??
    name
      .replace(/^generation_/, '')
      .split('_')
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(' ')
  );
}
