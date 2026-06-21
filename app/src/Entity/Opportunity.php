<?php

namespace App\Entity;

final class Opportunity
{
    public function __construct(
        public string $sourceUrl,
        public string $companyName,
        public string $title,
        public int $score = 0,
    ) {
    }
}
