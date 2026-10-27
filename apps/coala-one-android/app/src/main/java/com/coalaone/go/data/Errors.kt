package com.coalaone.go.data

import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerializationException
import retrofit2.HttpException
import java.io.IOException

enum class ErrorCategory { NETWORK, AUTHENTICATION, PERMISSION, CONFLICT, VALIDATION, RATE_LIMIT, SERVER, CONTRACT }
class AppFailure(val category: ErrorCategory, val retryable: Boolean, message: String, val code: String? = null) : IOException(message)
object Errors {
    private fun serverField(cause: Throwable, field: String): String? {
        if (cause !is HttpException) return null
        return runCatching {
            val source = cause.response()?.errorBody()?.source() ?: return@runCatching null
            source.request(Long.MAX_VALUE)
            val body = source.buffer.clone().readUtf8()
            kotlinx.serialization.json.Json.parseToJsonElement(body).let { it as? kotlinx.serialization.json.JsonObject }?.get("error")
                ?.let { it as? kotlinx.serialization.json.JsonObject }?.get(field)
                ?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
        }.getOrNull()?.trim()?.takeIf { it.isNotEmpty() && it.length <= 300 }
    }
    fun serverCode(cause: Throwable): String? = serverField(cause, "code")
    fun classify(cause: Throwable): AppFailure = when (cause) {
        is CancellationException -> throw cause
        is AppFailure -> cause
        is com.google.firebase.FirebaseNetworkException -> AppFailure(ErrorCategory.NETWORK, true, "Sem conexão. Seus dados pendentes continuam no aparelho.")
        is HttpException -> when (cause.code()) {
            401 -> AppFailure(ErrorCategory.AUTHENTICATION, false, "Entre novamente para continuar.")
            403 -> AppFailure(ErrorCategory.PERMISSION, false, "Seu perfil não permite esta ação, ou a atestação foi recusada.")
            409 -> AppFailure(ErrorCategory.CONFLICT, false, "Os dados mudaram no servidor. Atualize e confira antes de tentar novamente.")
            400, 413, 415, 422 -> AppFailure(ErrorCategory.VALIDATION, false, "Revise os campos e os documentos enviados.")
            429 -> AppFailure(ErrorCategory.RATE_LIMIT, true, "Aguarde antes de tentar novamente.")
            405 -> AppFailure(ErrorCategory.SERVER, true, "A API deste ambiente ainda não está disponível. O envio continua protegido no aparelho.")
            in 500..599 -> AppFailure(ErrorCategory.SERVER, true, "O serviço está indisponível. Tente novamente mais tarde.")
            else -> AppFailure(ErrorCategory.CONTRACT, false, "O servidor não confirmou esta operação.")
        }
        is IOException -> AppFailure(ErrorCategory.NETWORK, true, "Sem conexão. Seus dados pendentes continuam no aparelho.")
        is SerializationException -> AppFailure(ErrorCategory.CONTRACT, false, "A confirmação do servidor não pôde ser interpretada.")
        is IllegalArgumentException -> AppFailure(ErrorCategory.VALIDATION, false, cause.message ?: "Revise os dados.")
        else -> AppFailure(ErrorCategory.CONTRACT, false, "Não foi possível concluir. Tente novamente.")
    }
    /**
     * Ponto and Solicitações show the server's public message on a refused request ("Hora oficial indisponível",
     * "Já existe pedido em análise"), so the person knows what to fix. Only `error.message` of the sanitized
     * envelope is read; 401 and 5xx keep the generic text of [classify].
     */
    fun withServerMessage(cause: Throwable): Throwable {
        if (cause !is HttpException || cause.code() == 401 || cause.code() !in 400..499) return cause
        val message = serverField(cause, "message") ?: return cause
        val category = when (cause.code()) { 403 -> ErrorCategory.PERMISSION; 409 -> ErrorCategory.CONFLICT; 429 -> ErrorCategory.RATE_LIMIT; else -> ErrorCategory.VALIDATION }
        return AppFailure(category, cause.code() == 429, message, serverCode(cause))
    }
}
