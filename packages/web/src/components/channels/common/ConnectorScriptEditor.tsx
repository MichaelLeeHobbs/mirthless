// ===========================================
// Connector script editor
// ===========================================
// The script of a JavaScript source or destination, in the shared script
// editor. The script and its language live in the connector's properties
// (`script`, `scriptLanguage`); a script saved before languages were stored
// has none and reads as JavaScript (#200, D-296).

import { type ReactNode } from 'react';
import type { ScriptSurface } from '@galvanigraph/core-models';
import { ScriptEditor } from '../../editors/ScriptEditor.js';
import { loadedScriptLanguage } from '../../../lib/script-language.js';
import { getStr } from './connector-properties.js';

interface ConnectorScriptEditorProps {
  readonly properties: Record<string, unknown>;
  readonly onChange: (properties: Record<string, unknown>) => void;
  /** Names the editor, e.g. "Polling script". */
  readonly label: string;
  /** Where the engine runs the script (deploy checks it on the same surface). */
  readonly surface: Omit<ScriptSurface, 'dataType'>;
}

export function ConnectorScriptEditor({ properties, onChange, label, surface }: ConnectorScriptEditorProps): ReactNode {
  const script = getStr(properties, 'script', '');
  const language = loadedScriptLanguage(script, properties['scriptLanguage']);
  return (
    <ScriptEditor
      height="auto"
      label={label}
      surface={surface}
      value={script}
      // Store the language shown with the script: an empty script with none
      // shows TypeScript, but deploy reads a missing language as JavaScript (#228).
      onChange={(value) => { onChange({ ...properties, script: value, scriptLanguage: language }); }}
      language={language}
      onLanguageChange={(language) => { onChange({ ...properties, scriptLanguage: language }); }}
      showLanguageToggle
    />
  );
}
