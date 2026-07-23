using System.Net.Http;
using System.Windows;

namespace AiUsageWidget;

public partial class FeedbackWindow : Window
{
    private readonly Uri? _endpoint;
    private CancellationTokenSource? _submission;

    public FeedbackWindow()
    {
        InitializeComponent();
        _endpoint = FeedbackClient.LoadEndpoint();

        if (_endpoint is null)
        {
            SubmitButton.IsEnabled = false;
            SetStatus("제보 서버가 아직 설정되지 않았습니다. config.json의 feedbackEndpoint를 확인하세요.", true);
        }

        Closed += (_, _) => _submission?.Cancel();
        TitleBox.Focus();
    }

    private async void Submit_Click(object sender, RoutedEventArgs e)
    {
        var title = TitleBox.Text.Trim();
        var description = DescriptionBox.Text.Trim();
        if (title.Length == 0 || description.Length == 0)
        {
            SetStatus("제목과 내용을 모두 입력하세요.", true);
            return;
        }

        if (_endpoint is null)
            return;

        SubmitButton.IsEnabled = false;
        TitleBox.IsEnabled = false;
        DescriptionBox.IsEnabled = false;
        ContactBox.IsEnabled = false;
        SetStatus("제보를 보내는 중입니다…", false);
        _submission = new CancellationTokenSource();

        try
        {
            var result = await FeedbackClient.SubmitAsync(
                _endpoint,
                title,
                description,
                ContactBox.Text,
                _submission.Token);
            SetStatus($"제보가 등록되었습니다. Issue #{result.IssueNumber}", false);
        }
        catch (OperationCanceledException) when (_submission.IsCancellationRequested)
        {
            SetStatus("전송이 취소되었습니다. 입력 내용은 유지됩니다.", true);
        }
        catch (Exception ex) when (ex is FeedbackException or HttpRequestException or TaskCanceledException)
        {
            SetStatus($"{ex.Message} 잠시 후 다시 시도하세요. 입력 내용은 유지됩니다.", true);
            SubmitButton.IsEnabled = true;
        }
        finally
        {
            TitleBox.IsEnabled = true;
            DescriptionBox.IsEnabled = true;
            ContactBox.IsEnabled = true;
            _submission.Dispose();
            _submission = null;
        }
    }

    private void SetStatus(string message, bool isError)
    {
        StatusText.Text = message;
        StatusText.Foreground = isError
            ? System.Windows.Media.Brushes.Firebrick
            : System.Windows.Media.Brushes.DarkGreen;
    }
}
