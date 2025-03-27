[**@clickup/pg-mig**](../README.md)

***

[@clickup/pg-mig](../globals.md) / MigrateOptions

# Interface: MigrateOptions

Defined in: [src/cli.ts:33](https://github.com/clickup/pg-mig/blob/master/src/cli.ts#L33)

Options for the migrate() function.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="migdir"></a> `migDir` | `string` | The directory the migration versions are loaded from. |
| <a id="hosts"></a> `hosts` | `string`[] | List of PostgreSQL master hostnames or DSNs in the format: "host[:port][/database]" or "postgres://[user][:password][@]host[:port][/database]". The migration versions in `migDir` will be applied to all of them. |
| <a id="port"></a> `port?` | `number` | PostgreSQL port on each hosts. |
| <a id="user"></a> `user?` | `string` | PostgreSQL user on each host. |
| <a id="pass"></a> `pass?` | `string` | PostgreSQL password on each host. |
| <a id="db"></a> `db?` | `string` | PostgreSQL database name on each host. |
| <a id="createdb"></a> `createDB?` | `boolean` | If true, tries to create the given database. This is helpful when running the tool on a developer's machine. |
| <a id="parallelism"></a> `parallelism?` | `number` | How many schemas to process in parallel (defaults to 10). |
| <a id="dry"></a> `dry?` | `boolean` | If true, prints what it plans to do, but doesn't change anything. |
| <a id="force"></a> `force?` | `boolean` | If true, runs before/after files on apply even if nothing is changed. |
| <a id="action"></a> `action` | \{ `type`: `"make"`; `name`: `string`; \} \| \{ `type`: `"list"`; \} \| \{ `type`: `"digest"`; \} \| \{ `type`: `"undo"`; `version`: `string`; \} \| \{ `type`: `"apply"`; `after`: () => `void` \| `Promise`\<`void`\>[]; \} | What to do. |
