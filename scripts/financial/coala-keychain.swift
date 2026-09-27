import Foundation
import Security

private func fail(_ message: String, status: OSStatus) -> Never {
    let detail = SecCopyErrorMessageString(status, nil) as String? ?? "erro desconhecido"
    fputs("\(message) (código \(status): \(detail)).\n", stderr)
    exit(1)
}

private let service = "com.coalashakes.coala-one.cli-auth"
private let arguments = CommandLine.arguments
guard arguments.count == 3, ["read", "write"].contains(arguments[1]),
      !arguments[2].isEmpty else {
    fputs("Uso: coala-keychain.swift read|write EMAIL\n", stderr)
    exit(2)
}

let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: arguments[2],
    kSecAttrSynchronizable as String: false,
]

if arguments[1] == "read" {
    var search = query
    search[kSecReturnData as String] = true
    search[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(search as CFDictionary, &result)
    guard status == errSecSuccess else { fail("Falha ao ler o Chaves", status: status) }
    guard let token = result as? Data, !token.isEmpty else {
        fputs("Sessão vazia no Chaves.\n", stderr)
        exit(1)
    }
    FileHandle.standardOutput.write(token)
} else {
    let token = FileHandle.standardInput.readDataToEndOfFile()
    guard !token.isEmpty, token.count <= 8192 else {
        fputs("Sessão inválida.\n", stderr)
        exit(2)
    }
    let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: token] as CFDictionary)
    if status == errSecItemNotFound {
        var newItem = query
        newItem[kSecValueData as String] = token
        let addStatus = SecItemAdd(newItem as CFDictionary, nil)
        guard addStatus == errSecSuccess else { fail("Falha ao criar sessão no Chaves", status: addStatus) }
    } else if status != errSecSuccess {
        fail("Falha ao atualizar sessão no Chaves", status: status)
    }
}
