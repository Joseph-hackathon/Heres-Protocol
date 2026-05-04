#!/usr/bin/env node

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const ENV_PATH = path.join(ROOT, '.env.local')
const ENV_EXAMPLE_PATH = path.join(ROOT, '.env.example')

function usage() {
  console.log(`
Usage:
  node scripts/setup_cre.mjs --mode mock
  node scripts/setup_cre.mjs --mode real --webhook-url <url> [--api-key <key>] [--signing-secret <secret>] [--callback-secret <secret>] [--dispatch-secret <secret>]

Options:
  --mode <mock|real>          Setup target mode (default: mock)
  --webhook-url <url>         CRE workflow webhook URL (required in real mode)
  --api-key <key>             Optional Authorization bearer token for CRE
  --signing-secret <secret>   HMAC secret for dispatch signature (x-cre-signature)
  --callback-secret <secret>  HMAC secret for callback signature validation
  --dispatch-secret <secret>  Auth secret for /api/cre/dispatch
`)
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      args[key] = 'true'
      continue
    }
    args[key] = next
    i += 1
  }
  return args
}

function ensureEnvFile() {
  if (fs.existsSync(ENV_PATH)) return
  if (fs.existsSync(ENV_EXAMPLE_PATH)) {
    fs.copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH)
    return
  }
  fs.writeFileSync(ENV_PATH, '', 'utf8')
}

function upsertEnv(content, key, value) {
  const line = `${key}=${value}`
  const regex = new RegExp(`^${key}=.*$`, 'm')
  if (regex.test(content)) {
    return content.replace(regex, line)
  }
  if (!content.endsWith('\n') && content.length > 0) {
    return `${content}\n${line}\n`
  }
  return `${content}${line}\n`
}

function randomSecret() {
  return crypto.randomBytes(32).toString('hex')
}

function mask(value) {
  if (!value) return '(empty)'
  if (value.length <= 8) return '********'
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const mode = (args.mode || 'mock').toLowerCase()

  if (args.help === 'true' || args.h === 'true') {
    usage()
    process.exit(0)
  }

  if (mode !== 'mock' && mode !== 'real') {
    console.error(`Invalid mode: ${mode}`)
    usage()
    process.exit(1)
  }

  if (mode === 'real' && !args['webhook-url']) {
    console.error('--webhook-url is required in real mode')
    usage()
    process.exit(1)
  }

  ensureEnvFile()
  let envContent = fs.readFileSync(ENV_PATH, 'utf8')

  const signingSecret = args['signing-secret'] || randomSecret()
  const callbackSecret = args['callback-secret'] || ''
  const dispatchSecret = args['dispatch-secret'] || randomSecret()

  if (mode === 'mock') {
    envContent = upsertEnv(envContent, 'CHAINLINK_CRE_WEBHOOK_URL', 'http://127.0.0.1:3000/api/mock/cre')
    envContent = upsertEnv(envContent, 'CHAINLINK_CRE_API_KEY', '')
    envContent = upsertEnv(envContent, 'CHAINLINK_CRE_SIGNING_SECRET', args['signing-secret'] || 'dev-cre-signing-secret')
    envContent = upsertEnv(envContent, 'CHAINLINK_CRE_CALLBACK_SECRET', args['callback-secret'] || 'dev-cre-callback-secret')
    envContent = upsertEnv(envContent, 'CRE_DISPATCH_SECRET', args['dispatch-secret'] || 'dev-cre-dispatch-secret')
    envContent = upsertEnv(envContent, 'MOCK_CRE_AUTO_CALLBACK', 'true')
    envContent = upsertEnv(envContent, 'MOCK_CRE_FORCE_FAIL', 'false')
    envContent = upsertEnv(envContent, 'MOCK_CRE_CALLBACK_BASE_URL', 'http://127.0.0.1:3000')
  } else {
    envContent = upsertEnv(envContent, 'CHAINLINK_CRE_WEBHOOK_URL', args['webhook-url'])
    envContent = upsertEnv(envContent, 'CHAINLINK_CRE_API_KEY', args['api-key'] || '')
    envContent = upsertEnv(envContent, 'CHAINLINK_CRE_SIGNING_SECRET', signingSecret)
    envContent = upsertEnv(envContent, 'CHAINLINK_CRE_CALLBACK_SECRET', callbackSecret)
    envContent = upsertEnv(envContent, 'CRE_DISPATCH_SECRET', dispatchSecret)
    envContent = upsertEnv(envContent, 'MOCK_CRE_AUTO_CALLBACK', 'false')
    envContent = upsertEnv(envContent, 'MOCK_CRE_FORCE_FAIL', 'false')
  }

  fs.writeFileSync(ENV_PATH, envContent, 'utf8')

  console.log(`CRE setup completed: ${mode}`)
  console.log(`- file: ${ENV_PATH}`)
  console.log(`- CHAINLINK_CRE_WEBHOOK_URL: ${mode === 'mock' ? 'http://127.0.0.1:3000/api/mock/cre' : args['webhook-url']}`)
  console.log(`- CHAINLINK_CRE_API_KEY: ${args['api-key'] ? '(set)' : '(empty)'}`)
  console.log(`- CHAINLINK_CRE_SIGNING_SECRET: ${mask(mode === 'mock' ? args['signing-secret'] || 'dev-cre-signing-secret' : signingSecret)}`)
  console.log(`- CHAINLINK_CRE_CALLBACK_SECRET: ${mask(mode === 'mock' ? args['callback-secret'] || 'dev-cre-callback-secret' : callbackSecret)}`)
  console.log(`- CRE_DISPATCH_SECRET: ${mask(mode === 'mock' ? args['dispatch-secret'] || 'dev-cre-dispatch-secret' : dispatchSecret)}`)
}

main()
