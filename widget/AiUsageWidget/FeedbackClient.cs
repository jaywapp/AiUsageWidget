using System.Net.Http;
using System.Net.Http.Json;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace AiUsageWidget;

internal static class FeedbackClient
{
    internal const string Repository = "jaywapp/AiUsageWidget";
    private const int ProofDifficulty = 4;
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };

    internal static Uri? LoadEndpoint()
    {
        var environmentValue = Environment.GetEnvironmentVariable("AI_USAGE_FEEDBACK_ENDPOINT");
        if (TryCreateHttpsUri(environmentValue, out var environmentUri))
            return environmentUri;

        try
        {
            var path = Path.Combine(AppContext.BaseDirectory, "config.json");
            using var document = JsonDocument.Parse(File.ReadAllText(path));
            if (document.RootElement.TryGetProperty("feedbackEndpoint", out var property) &&
                TryCreateHttpsUri(property.GetString(), out var configUri))
                return configUri;
        }
        catch (IOException) { }
        catch (JsonException) { }

        return null;
    }

    internal static async Task<FeedbackResult> SubmitAsync(
        Uri endpoint,
        string title,
        string description,
        string? contact,
        CancellationToken cancellationToken)
    {
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var nonce = await Task.Run(
            () => CreateProof(timestamp, title, description, cancellationToken),
            cancellationToken);

        var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "unknown";
        var payload = new
        {
            repository = Repository,
            title,
            description,
            contact = string.IsNullOrWhiteSpace(contact) ? null : contact.Trim(),
            appVersion = version,
            platform = "windows",
            diagnostics = new { },
            website = "",
            proof = new { timestamp, nonce }
        };

        using var response = await Http.PostAsJsonAsync(endpoint, payload, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var message = TryReadMessage(body) ?? "제보를 보내지 못했습니다.";
            throw new FeedbackException(message);
        }

        var result = JsonSerializer.Deserialize<FeedbackResult>(
            body,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        return result ?? throw new FeedbackException("서버 응답을 확인할 수 없습니다.");
    }

    private static long CreateProof(
        long timestamp,
        string title,
        string description,
        CancellationToken cancellationToken)
    {
        var prefix = new string('0', ProofDifficulty);
        for (long nonce = 0; ; nonce++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var input = Encoding.UTF8.GetBytes($"{timestamp}:{nonce}:{title}:{description}");
            var hash = Convert.ToHexString(SHA256.HashData(input));
            if (hash.StartsWith(prefix, StringComparison.Ordinal))
                return nonce;
        }
    }

    private static bool TryCreateHttpsUri(string? value, out Uri? uri)
    {
        if (Uri.TryCreate(value, UriKind.Absolute, out var candidate) &&
            candidate.Scheme == Uri.UriSchemeHttps)
        {
            uri = candidate;
            return true;
        }

        uri = null;
        return false;
    }

    private static string? TryReadMessage(string body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            return document.RootElement.TryGetProperty("message", out var message)
                ? message.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

internal sealed record FeedbackResult(int IssueNumber, string? IssueUrl, string Message);

internal sealed class FeedbackException(string message) : Exception(message);
