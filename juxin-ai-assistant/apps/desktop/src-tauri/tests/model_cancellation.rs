use juxin_ai_assistant_lib::model_cancellation::ModelCancellationRegistry;

#[test]
fn cancel_all_revokes_every_in_flight_request() {
    // Given: two active model generations.
    let mut registry = ModelCancellationRegistry::default();
    let first = registry.start("first");
    let second = registry.start("second");

    // When: the workspace trust boundary is revoked.
    registry.cancel_all();

    // Then: both request receivers observe cancellation and the registry is empty.
    assert!(*first.receiver().borrow());
    assert!(*second.receiver().borrow());
    assert!(registry.is_empty());
}

#[test]
fn old_completion_cannot_remove_a_reused_request_identifier() {
    // Given: a request identifier reused by a newer generation.
    let mut registry = ModelCancellationRegistry::default();
    let first = registry.start("shared");
    let second = registry.start("shared");

    // When: the old request completes after the replacement starts.
    registry.finish(&first);

    // Then: the new request remains registered and can still be cancelled.
    assert!(*first.receiver().borrow());
    assert!(!*second.receiver().borrow());
    registry.cancel("shared");
    assert!(*second.receiver().borrow());
}
