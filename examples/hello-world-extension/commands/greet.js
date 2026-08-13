/**
 * Hello World Extension — Greet command
 * Demonstrates the minimal handler stub for an extension command.
 */

/**
 * @param {object} ctx - ExtensionContext
 * @param {object} args - Command arguments
 * @returns {Promise<string>}
 */
async function greet(ctx, args) {
  const name = args?.name ?? 'World';
  ctx.showNotification(`Hello, ${name}!`);
  return `Hello, ${name}!`;
}

module.exports = { greet };
