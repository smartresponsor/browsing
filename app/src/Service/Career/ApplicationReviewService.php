<?php

namespace App\Service\Career;

final class ApplicationReviewService
{
    public function requireSubmitApproval(array $payload): void
    {
        if (($payload['approved'] ?? false) !== true || ($payload['approvalText'] ?? '') !== 'SUBMIT') {
            throw new \RuntimeException('Explicit submit approval is required.');
        }
    }
}
