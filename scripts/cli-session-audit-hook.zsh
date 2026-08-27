# Auditoria de sessões de CLI no Coala OP.
# Registra somente ferramenta, repositório, commit, estado e código de saída.
# Não registra prompt, argumentos do comando nem variáveis de ambiente.

autoload -Uz add-zsh-hook

typeset -g COALA_CLI_AUDIT_REPOSITORY="/Users/imated/Coala Sistemas/Coala-OP"
typeset -g COALA_CLI_AUDIT_SCRIPT="$COALA_CLI_AUDIT_REPOSITORY/scripts/cli-session-audit.mjs"
typeset -g COALA_CLI_AUDIT_SESSION_ID=""
typeset -g COALA_CLI_AUDIT_ACTIVE=""
typeset -ga COALA_CLI_AUDIT_DEFAULT_CLIENTS
COALA_CLI_AUDIT_DEFAULT_CLIENTS=(codex claude gemini aider opencode cursor-agent)

_coala_cli_audit_detect_client() {
  local expanded_command="$1"
  local -a words configured_clients
  words=("${(z)expanded_command}")
  configured_clients=("${COALA_CLI_AUDIT_DEFAULT_CLIENTS[@]}")
  if [[ -n "${COALA_AUDITED_CLIS:-}" ]]; then
    configured_clients+=("${(@s/:/)COALA_AUDITED_CLIS}")
  fi

  local word executable client
  for word in "${words[@]}"; do
    executable="${word:t}"
    for client in "${configured_clients[@]}"; do
      if [[ "$executable" == "$client" ]]; then
        print -r -- "$client"
        return 0
      fi
    done
  done
  return 1
}

_coala_cli_audit_preexec() {
  [[ "$PWD" == "$COALA_CLI_AUDIT_REPOSITORY"(|/*) ]] || return 0
  [[ -f "$COALA_CLI_AUDIT_SCRIPT" ]] || return 0

  local client
  client="$(_coala_cli_audit_detect_client "$2")" || return 0

  local session_id
  session_id="$(node --env-file="$COALA_CLI_AUDIT_REPOSITORY/.env.local" \
    "$COALA_CLI_AUDIT_SCRIPT" start \
    --cli="$client" \
    --cwd="$PWD" 2>/dev/null)" || session_id=""

  if [[ -n "$session_id" ]]; then
    COALA_CLI_AUDIT_SESSION_ID="$session_id"
    COALA_CLI_AUDIT_ACTIVE="1"
    export COALA_OPERATION_SESSION_ID="$session_id"
  fi
}

_coala_cli_audit_precmd() {
  local previous_exit_code=$?
  [[ -n "$COALA_CLI_AUDIT_ACTIVE" && -n "$COALA_CLI_AUDIT_SESSION_ID" ]] || return 0

  node --env-file="$COALA_CLI_AUDIT_REPOSITORY/.env.local" \
    "$COALA_CLI_AUDIT_SCRIPT" finish \
    --session-id="$COALA_CLI_AUDIT_SESSION_ID" \
    --exit-code="$previous_exit_code" >/dev/null 2>&1 &!

  COALA_CLI_AUDIT_SESSION_ID=""
  COALA_CLI_AUDIT_ACTIVE=""
  unset COALA_OPERATION_SESSION_ID
}

add-zsh-hook preexec _coala_cli_audit_preexec
add-zsh-hook precmd _coala_cli_audit_precmd
