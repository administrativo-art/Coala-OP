package com.coalaone.go.data

import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerializationException
import retrofit2.HttpException
import java.io.IOException

enum class ErrorCategory { NETWORK, AUTHENTICATION, PERMISSION, CONFLICT, VALIDATION, RATE_LIMIT, SERVER, CONTRACT }
class AppFailure(val category: ErrorCategory, val retryable: Boolean, message: String) : IOException(message)
object Errors {
    fun classify(cause: Throwable): AppFailure = when (cause) {
        is CancellationException -> throw cause
        is AppFailure -> cause
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
}
