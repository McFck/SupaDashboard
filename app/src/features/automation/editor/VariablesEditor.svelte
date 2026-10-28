<script lang="ts">
  import Search from '@lucide/svelte/icons/search';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';
  import Pencil from '@lucide/svelte/icons/pencil';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import Switch from '$lib/components/ui/switch/switch.svelte';
  import Choice from '../../plugins/ui/Choice.svelte';
  import PluginMark from '../../plugins/ui/PluginMark.svelte';
  import { runtimeView } from '../../../app/runtime/state';
  import { parseVariableText, type VariableType, type VariableRecord } from '../variables';
  import { confirm } from '$lib/components/ui/confirmation/confirm.svelte';
  import { getRuntimeCommands } from '../../../app/runtime/context';

  const { requestRuntime } = getRuntimeCommands();

  let query = $state('');
  let creating = $state(false);
  let newName = $state('');
  let newType = $state<VariableType>('string');
  let newValue = $state('');
  let renamingId = $state('');
  let nameDrafts = $state<Record<string, string>>({});
  let valueDrafts = $state<Record<string, string>>({});
  let pending = $state<Record<string, boolean>>({});
  let errors = $state<Record<string, string>>({});
  const typeOptions = [
    { value: 'boolean', label: 'Boolean' },
    { value: 'integer', label: 'Integer' },
    { value: 'float', label: 'Float' },
    { value: 'string', label: 'Text' },
  ];
  const records = $derived(
    Object.values($runtimeView.variables.records).sort((a, b) =>
      a.definition.name.localeCompare(b.definition.name, undefined, { sensitivity: 'base' }),
    ),
  );
  const filtered = $derived.by(() => {
    const term = query.trim().toLocaleLowerCase();
    return term
      ? records.filter((record) =>
          `${record.definition.name} ${record.definition.type} ${record.definition.owner}`
            .toLocaleLowerCase()
            .includes(term),
        )
      : records;
  });

  function isEditable(record: VariableRecord) {
    return (
      record.definition.owner === 'user' &&
      !record.definition.readOnly &&
      record.definition.available !== false
    );
  }
  function textValue(record: VariableRecord) {
    return valueDrafts[record.definition.id] ?? String(record.value);
  }
  function initialFor(type: VariableType) {
    return type === 'boolean' ? 'false' : type === 'string' ? '' : '0';
  }
  function markError(key: string, error: unknown) {
    errors = { ...errors, [key]: error instanceof Error ? error.message : 'Update failed' };
  }
  async function mutate(
    key: string,
    type:
      | 'setVariable'
      | 'createVariable'
      | 'renameVariable'
      | 'setVariablePersistence'
      | 'deleteVariable',
    payload: Record<string, unknown>,
  ) {
    if (pending[key]) return false;
    pending = { ...pending, [key]: true };
    const nextErrors = { ...errors };
    delete nextErrors[key];
    errors = nextErrors;
    try {
      await requestRuntime({ type, payload });
      return true;
    } catch (error) {
      markError(key, error);
      return false;
    } finally {
      const next = { ...pending };
      delete next[key];
      pending = next;
    }
  }
  async function saveValue(record: VariableRecord, value: unknown) {
    const key = `value:${record.definition.id}`;
    if (pending[key]) return;
    try {
      await mutate(key, 'setVariable', { id: record.definition.id, value });
    } catch (error) {
      markError(key, error);
    }
  }
  async function saveTextValue(record: VariableRecord) {
    const key = `value:${record.definition.id}`;
    try {
      await saveValue(record, parseVariableText(record.definition.type, textValue(record)));
    } catch (error) {
      markError(key, error);
    }
  }
  async function createVariable() {
    try {
      const initialValue = parseVariableText(newType, newValue);
      const created = await mutate('create', 'createVariable', {
        name: newName,
        type: newType,
        initialValue,
      });
      if (created) {
        creating = false;
        newName = '';
        newType = 'string';
        newValue = '';
      }
    } catch (error) {
      markError('create', error);
    }
  }
  function beginRename(record: VariableRecord) {
    renamingId = record.definition.id;
    nameDrafts = { ...nameDrafts, [record.definition.id]: record.definition.name };
  }
  async function rename(record: VariableRecord) {
    const id = record.definition.id;
    if (
      await mutate(`name:${id}`, 'renameVariable', {
        id,
        name: nameDrafts[id] ?? record.definition.name,
      })
    )
      renamingId = '';
  }
  async function remove(record: VariableRecord) {
    const id = record.definition.id;
    if (
      !(await confirm({
        title: `Delete ${record.definition.name}?`,
        action: 'Delete',
        destructive: true,
      }))
    )
      return;
    await mutate(`delete:${id}`, 'deleteVariable', { id });
  }
  function displayOwner(record: VariableRecord) {
    if (record.definition.available === false) return `Unavailable · ${record.definition.owner}`;
    return record.definition.owner === 'user' ? 'User' : record.definition.owner;
  }
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
  <div class="grid shrink-0 gap-3 border-b p-4">
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative min-w-48 flex-1">
        <Search
          class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Search variables"
          class="pl-8"
          placeholder="Search variables"
          bind:value={query}
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        onclick={() => {
          creating = !creating;
          errors = {};
        }}><Plus /> New</Button
      >
    </div>
    {#if creating}
      <div class="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2">
        <div class="grid gap-1.5">
          <Label for="new-variable-name">Name</Label><Input
            id="new-variable-name"
            bind:value={newName}
          />
        </div>
        <div class="grid gap-1.5">
          <Label>Type</Label><Choice
            value={newType}
            options={typeOptions}
            onchange={(value) => {
              newType = value as VariableType;
              newValue = initialFor(newType);
            }}
          />
        </div>
        <div class="grid gap-1.5">
          <Label for="new-variable-value">Initial value</Label>
          {#if newType === 'boolean'}<Choice
              value={newValue || 'false'}
              options={[
                { value: 'false', label: 'False' },
                { value: 'true', label: 'True' },
              ]}
              aria-label="Initial value"
              onchange={(value) => (newValue = value)}
            />
          {:else}<Input
              id="new-variable-value"
              type={newType === 'string' ? 'text' : 'number'}
              step={newType === 'integer' ? '1' : 'any'}
              value={newValue}
              oninput={(event) => (newValue = event.currentTarget.value)}
            />{/if}
        </div>
        <div class="flex items-end gap-2">
          <Button
            size="sm"
            onclick={createVariable}
            disabled={!newName.trim() || pending.create}>Create</Button
          >
          <Button
            size="sm"
            variant="ghost"
            onclick={() => (creating = false)}>Cancel</Button
          >
        </div>
        {#if errors.create}<span
            class="text-sm text-destructive"
            aria-live="polite">{errors.create}</span
          >{/if}
      </div>
    {/if}
  </div>
  <div class="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-gutter:stable]">
    {#if filtered.length}
      <div class="grid gap-2">
        {#each filtered as record (record.definition.id)}
          {@const id = record.definition.id}
          {@const editable = isEditable(record)}
          <article
            class="grid min-w-0 gap-3 rounded-xl border bg-card p-3 lg:grid-cols-[minmax(0,1fr)_minmax(180px,1fr)_auto] lg:items-center"
          >
            <div class="grid min-w-0 gap-1">
              {#if renamingId === id && editable}
                <div class="flex min-w-0 gap-2">
                  <Input
                    aria-label="Variable name"
                    value={nameDrafts[id] ?? record.definition.name}
                    oninput={(event) =>
                      (nameDrafts = { ...nameDrafts, [id]: event.currentTarget.value })}
                  />
                  <Button
                    size="sm"
                    disabled={pending[`name:${id}`]}
                    onclick={() => rename(record)}>Save</Button
                  >
                </div>
              {:else}
                <div class="flex min-w-0 items-center gap-2">
                  <span class="min-w-0 flex-1 truncate font-medium">{record.definition.name}</span>
                  <PluginMark plugin={record.definition.owner} />
                  {#if editable}<Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Rename ${record.definition.name}`}
                      onclick={() => beginRename(record)}><Pencil /></Button
                    >{/if}
                </div>
              {/if}
              <span class="truncate text-xs text-muted-foreground"
                >{record.definition.type} · {displayOwner(record)}</span
              >
            </div>
            {#if editable}
              <div class="flex min-w-0 gap-2">
                {#if record.definition.type === 'boolean'}
                  <div class="min-w-0 flex-1">
                    <Choice
                      value={String(record.value)}
                      options={[
                        { value: 'false', label: 'False' },
                        { value: 'true', label: 'True' },
                      ]}
                      aria-label={`${record.definition.name} value`}
                      onchange={(value) => saveValue(record, value === 'true')}
                    />
                  </div>
                {:else}
                  <Input
                    aria-label={`${record.definition.name} value`}
                    type={record.definition.type === 'string' ? 'text' : 'number'}
                    step={record.definition.type === 'integer' ? '1' : 'any'}
                    value={textValue(record)}
                    oninput={(event) =>
                      (valueDrafts = { ...valueDrafts, [id]: event.currentTarget.value })}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending[`value:${id}`]}
                    onclick={() => saveTextValue(record)}>Set</Button
                  >
                {/if}
              </div>
            {:else}
              <span class="min-w-0 truncate text-sm">{String(record.value)}</span>
            {/if}
            <div class="flex flex-wrap items-center gap-3 lg:justify-end">
              {#if editable}
                <label class="flex items-center gap-2 text-xs text-muted-foreground"
                  >Persistent
                  <Switch
                    checked={record.definition.persistent}
                    disabled={pending[`persist:${id}`]}
                    onCheckedChange={(checked) =>
                      mutate(`persist:${id}`, 'setVariablePersistence', {
                        id,
                        persistent: checked,
                      })}
                  />
                </label>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete ${record.definition.name}`}
                  disabled={pending[`delete:${id}`]}
                  onclick={() => remove(record)}><Trash /></Button
                >
              {:else}<span class="text-xs text-muted-foreground">Read only</span>{/if}
            </div>
            {#if errors[`value:${id}`] || errors[`name:${id}`] || errors[`persist:${id}`] || errors[`delete:${id}`]}
              <span
                class="text-xs text-destructive lg:col-span-3"
                aria-live="polite"
                >{errors[`value:${id}`] ??
                  errors[`name:${id}`] ??
                  errors[`persist:${id}`] ??
                  errors[`delete:${id}`]}</span
              >
            {/if}
          </article>
        {/each}
      </div>
    {:else}<div class="py-8 text-center text-sm text-muted-foreground">No variables</div>{/if}
  </div>
</div>
