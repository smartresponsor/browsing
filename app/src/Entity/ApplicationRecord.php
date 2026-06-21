<?php

namespace App\Entity;

final class ApplicationRecord
{
    public function __construct(
        public string $opportunityUrl,
        public string $status,
        public array $submittedField = [],
        public ?string $submittedAt = null,
    ) {
    }
}
