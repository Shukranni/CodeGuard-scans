"""
Provider adapters for the AI explanation service.

The backend owns the provider credentials — they are read from the process
environment and never leave the server.  Two wire protocols are supported:

``openai``
    Any OpenAI-compatible ``/chat/completions`` endpoint (OpenAI itself or a
    compatible gateway).  Configured with ``OPENAI_API_KEY``,
    ``OPENAI_BASE_URL`` and ``OPENAI_MODEL``.

``anthropic``
    The Anthropic Messages API.  Configured with ``ANTHROPIC_API_KEY``,
    ``ANTHROPIC_BASE_URL`` and ``ANTHROPIC_MODEL``.

``openrouter``
    The OpenRouter gateway (an OpenAI-compatible ``/chat/completions``
    endpoint that fronts many models).  Configured with
    ``OPENROUTER_API_KEY``, ``OPENROUTER_BASE_URL`` and ``OPENROUTER_MODEL``.
    Any other OpenAI-compatible gateway can be used the same way through
    ``OPENAI_BASE_URL`` / ``OPENAI_MODEL``.

Both adapters implement the same tiny interface (``complete(system, user)``)
so the explanation service never has to know which provider is in use.  Every
failure mode the UI has to handle — missing configuration, invalid credentials,
insufficient credits, an unavailable model, rate limits, timeouts, provider
outages and malformed responses — is mapped to a dedicated exception carrying a
stable error code and an HTTP status.
"""
import logging

import requests
from django.conf import settings

logger = logging.getLogger('scans.ai')

DEFAULT_TIMEOUT_SECONDS = 45
MAX_RESPONSE_BYTES = 200_000


# ── Errors ────────────────────────────────────────────────────────────────────

class AIProviderError(Exception):
    """Base class for every AI provider failure."""

    code = 'ai_provider_error'
    status_code = 502
    retryable = True

    def __init__(self, message, retryable=None):
        super().__init__(message)
        self.message = message
        if retryable is not None:
            self.retryable = retryable


class AIConfigurationError(AIProviderError):
    """No AI provider is configured on the backend."""

    code = 'ai_not_configured'
    status_code = 503
    retryable = False


class AIProviderAuthError(AIProviderError):
    """The provider rejected the configured credentials."""

    code = 'ai_invalid_credentials'
    status_code = 502
    retryable = False


class AIInsufficientCreditsError(AIProviderError):
    """The provider account has no credits left."""

    code = 'ai_insufficient_credits'
    status_code = 402
    retryable = False


class AIModelUnavailableError(AIProviderError):
    """The requested model is unknown or cannot serve the request."""

    code = 'ai_model_unavailable'
    status_code = 404
    retryable = False


class AIProviderRateLimitError(AIProviderError):
    """The provider is rate limiting us."""

    code = 'ai_rate_limited'
    status_code = 429
    retryable = True

    def __init__(self, message, retry_after=None):
        super().__init__(message)
        self.retry_after = retry_after


class AIProviderTimeoutError(AIProviderError):
    """The provider did not answer in time."""

    code = 'ai_timeout'
    status_code = 504
    retryable = True


class AIProviderUnavailableError(AIProviderError):
    """The provider is unreachable or returned a server error."""

    code = 'ai_unavailable'
    status_code = 503
    retryable = True


class AIInvalidResponseError(AIProviderError):
    """The provider answered with something that is not usable."""

    code = 'ai_invalid_response'
    status_code = 502
    retryable = True


class AIIncompleteResponseError(AIProviderError):
    """The provider stopped before it could finish the answer."""

    code = 'ai_incomplete_response'
    status_code = 502
    retryable = True


# ── Shared HTTP behaviour ─────────────────────────────────────────────────────

class BaseProvider:
    """Common request/response handling for the provider adapters."""

    name = 'base'
    default_base_url = ''
    default_model = ''
    default_max_tokens = 4096

    def __init__(self, api_key, model=None, base_url=None, timeout=None, max_tokens=None):
        self.api_key = (api_key or '').strip()
        self.model = model or self.default_model
        self.base_url = (base_url or self.default_base_url).rstrip('/')
        self.timeout = timeout or getattr(settings, 'AI_TIMEOUT_SECONDS', DEFAULT_TIMEOUT_SECONDS)
        # 0 in the settings means "use the provider default".
        self.max_tokens = int(
            max_tokens or getattr(settings, 'AI_MAX_TOKENS', 0) or self.default_max_tokens
        )

    # -- to be implemented by the concrete adapters --------------------------
    def _endpoint(self):
        raise NotImplementedError

    def _headers(self):
        raise NotImplementedError

    def _payload(self, system_prompt, user_prompt):
        raise NotImplementedError

    def _extract_text(self, data):
        raise NotImplementedError

    def _finish_reason(self, data):
        """Why the provider stopped. ``'length'`` means it ran out of tokens."""
        choices = (data or {}).get('choices') or []
        if not choices:
            return ''
        return str(choices[0].get('finish_reason') or '').strip()

    # -- shared --------------------------------------------------------------
    def complete(self, system_prompt, user_prompt):
        """Run a completion and return the model's text output."""
        if not self.api_key:
            raise AIConfigurationError(
                'The AI provider API key is empty. Configure it on the backend.'
            )

        url = self._endpoint()
        try:
            response = requests.post(
                url,
                headers=self._headers(),
                json=self._payload(system_prompt, user_prompt),
                timeout=self.timeout,
            )
        except requests.exceptions.Timeout:
            raise AIProviderTimeoutError(
                'The AI provider did not respond in time. Please try again.'
            )
        except requests.exceptions.RequestException:
            raise AIProviderUnavailableError(
                'The AI provider could not be reached. Please try again shortly.'
            )

        status = getattr(response, 'status_code', 0)

        if status in (401, 403):
            # Never echo the provider's body — it may quote the key back.
            logger.warning('AI provider rejected the configured credentials (status %s).', status)
            raise AIProviderAuthError(
                'The AI provider rejected the configured credentials. '
                'Check the API key configured on the backend.'
            )

        if status == 402:
            raise AIInsufficientCreditsError(
                'The AI provider account has no credits left. '
                'An administrator has to top up the provider account.'
            )

        if status == 404:
            raise AIModelUnavailableError(
                'The configured AI model is not available. '
                'Check the model name configured on the backend.'
            )

        if status == 429:
            retry_after = None
            try:
                retry_after = int(response.headers.get('Retry-After', 0)) or None
            except (TypeError, ValueError):
                retry_after = None
            raise AIProviderRateLimitError(
                'The AI provider is rate limiting requests. Please wait a moment and try again.',
                retry_after=retry_after,
            )

        if status >= 500:
            raise AIProviderUnavailableError(
                'The AI provider is currently unavailable. Please try again shortly.'
            )

        if status >= 400:
            # A request the provider rejected will not be accepted by sending
            # it again — the configuration or the request has to change first.
            raise AIProviderError(
                'The AI provider rejected the request. '
                'Please check the provider configuration.',
                retryable=False,
            )

        try:
            data = response.json()
        except ValueError:
            raise AIInvalidResponseError(
                'The AI provider returned a response that could not be parsed.'
            )

        text = self._extract_text(data)
        if not text or not str(text).strip():
            if self._finish_reason(data) == 'length':
                # Reasoning models spend their whole budget on thinking and
                # then return no answer at all — say so instead of blaming
                # the answer itself.
                raise AIIncompleteResponseError(
                    'The AI provider ran out of tokens before it could finish '
                    'the answer. Increase AI_MAX_TOKENS or use a smaller model.'
                )
            raise AIInvalidResponseError(
                'The AI provider returned an empty response.'
            )
        return str(text)[:MAX_RESPONSE_BYTES]


class OpenAIChatProvider(BaseProvider):
    """OpenAI-compatible ``/chat/completions`` client."""

    name = 'openai'
    default_base_url = 'https://api.openai.com/v1'
    default_model = 'gpt-4o-mini'

    def _endpoint(self):
        return f'{self.base_url}/chat/completions'

    def _headers(self):
        return {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json',
        }

    def _payload(self, system_prompt, user_prompt):
        return {
            'model': self.model,
            'messages': [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt},
            ],
            'temperature': 0.2,
            'max_tokens': self.max_tokens,
        }

    def _extract_text(self, data):
        choices = (data or {}).get('choices') or []
        if not choices:
            return ''
        message = choices[0].get('message') or {}
        return message.get('content') or ''


class OpenRouterProvider(OpenAIChatProvider):
    """
    OpenRouter — an OpenAI-compatible gateway that fronts many models.

    It speaks the same ``/chat/completions`` protocol as OpenAI, so only the
    base URL, the default model and the attribution headers differ.
    """

    name = 'openrouter'
    default_base_url = 'https://openrouter.ai/api/v1'
    default_model = 'minimax/minimax-m3.1-flash:free'
    # Reasoning models spend part of their budget on "reasoning" tokens, so
    # they need a larger limit than a plain chat model.
    default_max_tokens = 8192

    def __init__(self, api_key, model=None, base_url=None, timeout=None, max_tokens=None):
        super().__init__(
            api_key=api_key, model=model, base_url=base_url,
            timeout=timeout, max_tokens=max_tokens,
        )
        self.site_url = (getattr(settings, 'OPENROUTER_SITE_URL', '') or '').strip()
        self.app_name = (getattr(settings, 'OPENROUTER_APP_NAME', '') or '').strip()
        # Optional: some models spend a lot of budget on "reasoning" tokens.
        # "low"/"minimal"/"high" are forwarded only when explicitly configured.
        self.reasoning_effort = (getattr(settings, 'OPENROUTER_REASONING_EFFORT', '') or '').strip()

    def _headers(self):
        headers = super()._headers()
        # Optional attribution headers used by OpenRouter for app ranking.
        if self.site_url:
            headers['HTTP-Referer'] = self.site_url
        if self.app_name:
            headers['X-Title'] = self.app_name
        return headers

    def _payload(self, system_prompt, user_prompt):
        payload = super()._payload(system_prompt, user_prompt)
        if self.reasoning_effort:
            payload['reasoning_effort'] = self.reasoning_effort
        return payload


class AnthropicMessagesProvider(BaseProvider):
    """Anthropic Messages API client."""

    name = 'anthropic'
    default_base_url = 'https://api.anthropic.com'
    default_model = 'claude-3-5-haiku-latest'
    api_version = '2023-06-01'

    def _endpoint(self):
        return f'{self.base_url}/v1/messages'

    def _headers(self):
        return {
            'x-api-key': self.api_key,
            'anthropic-version': self.api_version,
            'Content-Type': 'application/json',
        }

    def _payload(self, system_prompt, user_prompt):
        return {
            'model': self.model,
            'system': system_prompt,
            'messages': [{'role': 'user', 'content': user_prompt}],
            'temperature': 0.2,
            'max_tokens': self.max_tokens,
        }

    def _finish_reason(self, data):
        """Anthropic calls it ``stop_reason``; ``max_tokens`` means 'length'."""
        blocks = (data or {}).get('content') or []
        reason = str((data or {}).get('stop_reason') or '').strip()
        if reason == 'max_tokens':
            return 'length'
        if reason:
            return reason
        return super()._finish_reason(data)

    def _extract_text(self, data):
        blocks = (data or {}).get('content') or []
        parts = [
            block.get('text', '')
            for block in blocks
            if isinstance(block, dict) and block.get('type') in (None, 'text')
        ]
        return '\n'.join(part for part in parts if part)


# ── Factory ───────────────────────────────────────────────────────────────────

def get_ai_provider():
    """
    Return the configured AI provider.

    Raises :class:`AIConfigurationError` when no credentials are available so
    the API can answer with an actionable message instead of hanging.
    """
    provider_name = (getattr(settings, 'AI_PROVIDER', 'auto') or 'auto').strip().lower()

    if provider_name == 'openai':
        return OpenAIChatProvider(
            api_key=getattr(settings, 'OPENAI_API_KEY', ''),
            model=getattr(settings, 'OPENAI_MODEL', OpenAIChatProvider.default_model),
            base_url=getattr(settings, 'OPENAI_BASE_URL', OpenAIChatProvider.default_base_url),
        )

    if provider_name == 'anthropic':
        return AnthropicMessagesProvider(
            api_key=getattr(settings, 'ANTHROPIC_API_KEY', ''),
            model=getattr(settings, 'ANTHROPIC_MODEL', AnthropicMessagesProvider.default_model),
            base_url=getattr(settings, 'ANTHROPIC_BASE_URL', AnthropicMessagesProvider.default_base_url),
        )

    if provider_name == 'openrouter':
        return OpenRouterProvider(
            api_key=getattr(settings, 'OPENROUTER_API_KEY', ''),
            model=getattr(settings, 'OPENROUTER_MODEL', OpenRouterProvider.default_model),
            base_url=getattr(settings, 'OPENROUTER_BASE_URL', OpenRouterProvider.default_base_url),
        )

    # ``auto`` — pick whichever provider has credentials configured.
    if getattr(settings, 'OPENAI_API_KEY', ''):
        return OpenAIChatProvider(
            api_key=settings.OPENAI_API_KEY,
            model=getattr(settings, 'OPENAI_MODEL', OpenAIChatProvider.default_model),
            base_url=getattr(settings, 'OPENAI_BASE_URL', OpenAIChatProvider.default_base_url),
        )
    if getattr(settings, 'ANTHROPIC_API_KEY', ''):
        return AnthropicMessagesProvider(
            api_key=settings.ANTHROPIC_API_KEY,
            model=getattr(settings, 'ANTHROPIC_MODEL', AnthropicMessagesProvider.default_model),
            base_url=getattr(settings, 'ANTHROPIC_BASE_URL', AnthropicMessagesProvider.default_base_url),
        )
    if getattr(settings, 'OPENROUTER_API_KEY', ''):
        return OpenRouterProvider(
            api_key=settings.OPENROUTER_API_KEY,
            model=getattr(settings, 'OPENROUTER_MODEL', OpenRouterProvider.default_model),
            base_url=getattr(settings, 'OPENROUTER_BASE_URL', OpenRouterProvider.default_base_url),
        )

    raise AIConfigurationError(
        'AI explanations are not configured on this server. '
        'Set OPENAI_API_KEY (or ANTHROPIC_API_KEY, or OPENROUTER_API_KEY) '
        'in the backend environment.'
    )


def ai_service_status():
    """Return a non-sensitive description of the configured AI service."""
    try:
        provider = get_ai_provider()
    except AIConfigurationError as exc:
        return {'configured': False, 'provider': None, 'model': None, 'message': exc.message}
    return {
        'configured': True,
        'provider': provider.name,
        'model': provider.model,
        'message': '',
    }
