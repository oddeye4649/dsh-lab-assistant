export async function loadHostDeps() {
  const notes = []
  let defineTool = null

  try {
    const mod = await import('@deepseek-ai/dsh-tools')
    if (typeof mod?.defineTool === 'function') {
      defineTool = mod.defineTool
      notes.push('使用宿主提供的 @deepseek-ai/dsh-tools')
    }
  } catch {
    notes.push('宿主未暴露 @deepseek-ai/dsh-tools，使用兼容包装器')
  }

  if (!defineTool) {
    defineTool = (options) => {
      if (!options || typeof options !== 'object') throw new Error('defineTool 需要工具定义对象')
      if (typeof options.name !== 'string' || !options.name) throw new Error('工具必须有 name')
      if (typeof options.execute !== 'function') throw new Error(`工具 ${options.name} 必须有 execute`)
      for (const [where, schema] of [['parameters', options.parameters], ['output.schema', options.output?.schema]]) {
        if (schema && schema.type === 'object' && schema.additionalProperties === undefined) {
          throw new Error(`defineTool(${options.name}): ${where} 是 object 时必须声明 additionalProperties`)
        }
      }
      return options
    }
  }

  return { defineTool, notes }
}
