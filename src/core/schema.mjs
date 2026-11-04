import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas');
const cache = new Map();

export function loadSchema(name) {
  if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(join(SCHEMA_DIR, `${name}.json`), 'utf8')));
  return cache.get(name);
}

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const typeMatches = (v, t) => [].concat(t).some((x) => x === typeOf(v) || (x === 'number' && typeOf(v) === 'integer'));

// JSON Schema 의 부분집합: type, enum, const, required, properties, additionalProperties, items, pattern, minimum, maximum, minLength, $ref(#/$defs/*).
export function validate(value, schema, root = schema, path = '$') {
  const errors = [];
  if (schema.$ref) {
    const name = schema.$ref.replace('#/$defs/', '');
    return validate(value, root.$defs[name], root, path);
  }
  if (schema.type && !typeMatches(value, schema.type)) return [`${path}: ${[].concat(schema.type).join('|')} 이어야 함 (실제 ${typeOf(value)})`];
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path}: ${JSON.stringify(schema.const)} 이어야 함`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${schema.enum.join('|')} 중 하나여야 함`);
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: 형식 ${schema.pattern} 과 맞지 않음`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: 비어 있으면 안 됨`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: ${schema.minimum} 이상이어야 함`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: ${schema.maximum} 이하여야 함`);
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => errors.push(...validate(v, schema.items, root, `${path}[${i}]`)));
  if (typeOf(value) === 'object') {
    for (const k of schema.required ?? []) if (!(k in value)) errors.push(`${path}.${k}: 필수`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) errors.push(...validate(v, schema.properties[k], root, `${path}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${k}: 허용되지 않은 키`);
      else if (typeof schema.additionalProperties === 'object') errors.push(...validate(v, schema.additionalProperties, root, `${path}.${k}`));
    }
  }
  return errors;
}

export function check(value, name) {
  const errors = validate(value, loadSchema(name));
  if (errors.length) {
    const e = new Error(`${name} 스키마 위반: ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? ` 외 ${errors.length - 5}건` : ''}`);
    e.code = 'SCHEMA';
    throw e;
  }
  return value;
}
